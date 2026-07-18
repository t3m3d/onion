import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const options = parseArgs(process.argv.slice(2));
const source = new URL(options.source);
const outputRoot = path.resolve(options.output);
const projectRoot = path.resolve(process.cwd());

if (!/^https?:$/.test(source.protocol)) throw new Error("--source must use http:// or https://");
if (outputRoot === projectRoot || !outputRoot.startsWith(`${projectRoot}${path.sep}`)) {
  throw new Error("--output must be child directory of current project");
}

if (options.clean) await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const queued = new Set();
const completed = new Map();
const failures = [];
const externalSubresources = new Set();
const queue = [];
const compatibilityRewrites = new Map([
  ["/programs.html", "/programs/"],
  ["/path-coming-soon", "/brain.html"],
]);

enqueue(source, "entrypoint");

let cursor = 0;
while (cursor < queue.length) {
  const batch = queue.slice(cursor, cursor + options.concurrency);
  cursor += batch.length;
  await Promise.all(batch.map(mirrorUrl));
}

const report = {
  source: source.href,
  compatibilityRewrites: Object.fromEntries(compatibilityRewrites),
  files: [...completed.entries()]
    .map(([url, file]) => ({ url, file }))
    .sort((a, b) => a.file.localeCompare(b.file)),
  externalSubresources: [...externalSubresources].sort(),
  failures,
};

await writeFile(path.join(outputRoot, "mirror-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Mirrored ${completed.size} resources into ${path.relative(projectRoot, outputRoot)}.`);
if (externalSubresources.size) {
  console.log(`Recorded ${externalSubresources.size} external subresource(s); onion CSP blocks them.`);
}
if (failures.length) {
  console.error(`${failures.length} resource(s) failed. See site/mirror-report.json.`);
  process.exitCode = 1;
}

async function mirrorUrl(url) {
  const key = canonicalKey(url);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": "KryptonOnionMirror/1.0 (+https://krypton-lang.org/)",
        accept: "*/*",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (new URL(response.url).origin !== source.origin) {
      throw new Error(`redirect left source origin: ${response.url}`);
    }

    const contentType = (response.headers.get("content-type") || "application/octet-stream")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    const bytes = Buffer.from(await response.arrayBuffer());
    const relativeFile = localFileFor(url, contentType);
    const absoluteFile = path.join(outputRoot, relativeFile);
    await mkdir(path.dirname(absoluteFile), { recursive: true });

    if (isTextContent(contentType, relativeFile)) {
      let text = bytes.toString("utf8");
      discoverReferences(text, url, contentType);
      text = rewriteSameOriginUrls(text);
      await writeFile(absoluteFile, text, "utf8");
    } else {
      await writeFile(absoluteFile, bytes);
    }

    completed.set(key, toPosix(relativeFile));
    console.log(`saved ${toPosix(relativeFile)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ url: key, error: message });
    console.error(`failed ${key}: ${message}`);
  }
}

function discoverReferences(text, baseUrl, contentType) {
  const candidates = [];
  if (contentType.includes("html") || contentType.includes("xml")) {
    const attributePattern = /\b(?:href|src|poster|data-src|action|formaction)\s*=\s*(["'])(.*?)\1/giu;
    for (const match of text.matchAll(attributePattern)) {
      candidates.push({ value: match[2], subresource: /\b(?:src|poster|data-src)\s*=/iu.test(match[0]) });
    }
    const srcsetPattern = /\bsrcset\s*=\s*(["'])(.*?)\1/giu;
    for (const match of text.matchAll(srcsetPattern)) {
      for (const item of match[2].split(",")) {
        candidates.push({ value: item.trim().split(/\s+/u, 1)[0], subresource: true });
      }
    }
  }
  if (contentType.includes("css") || contentType.includes("html")) {
    for (const match of text.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/giu)) {
      candidates.push({ value: match[2], subresource: true });
    }
  }
  if (contentType.includes("css")) {
    for (const match of text.matchAll(/@import\s+(?:url\()?\s*(["'])(.*?)\1/giu)) {
      candidates.push({ value: match[2], subresource: true });
    }
  }
  if (contentType.includes("javascript") || contentType.includes("json") || contentType.includes("html")) {
    const assetLiteral = /["'`](\/[^"'`\s]+?\.(?:css|html?|js|mjs|wasm|json|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|txt|xml|pdf|zip)(?:\?[^"'`\s]*)?)["'`]/giu;
    for (const match of text.matchAll(assetLiteral)) {
      candidates.push({ value: match[1], subresource: true });
    }
  }

  for (const candidate of candidates) {
    const resolved = resolveReference(candidate.value, baseUrl);
    if (!resolved) continue;
    if (resolved.origin === source.origin) enqueue(resolved, baseUrl.href);
    else if (candidate.subresource && /^https?:$/.test(resolved.protocol)) externalSubresources.add(resolved.href);
  }
}

function enqueue(value, discoveredFrom) {
  const url = value instanceof URL ? new URL(value.href) : new URL(value, source);
  if (url.origin !== source.origin || !/^https?:$/.test(url.protocol)) return;
  url.hash = "";
  const key = canonicalKey(url);
  if (queued.has(key)) return;
  queued.add(key);
  queue.push(url);
  if (options.verbose) console.log(`queued ${key} from ${discoveredFrom}`);
}

function canonicalKey(value) {
  const url = value instanceof URL ? new URL(value.href) : new URL(value, source);
  url.hash = "";
  url.search = "";
  return url.href;
}

function resolveReference(value, baseUrl) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("${") || trimmed.startsWith("#") || /^(?:data|mailto|tel|javascript|blob):/iu.test(trimmed)) {
    return null;
  }
  try {
    const resolved = new URL(trimmed, baseUrl);
    if (resolved.origin === source.origin && compatibilityRewrites.has(resolved.pathname)) {
      resolved.pathname = compatibilityRewrites.get(resolved.pathname);
    }
    return resolved;
  } catch {
    return null;
  }
}

function rewriteSameOriginUrls(text) {
  let rewritten = text;
  for (const origin of [source.origin, `//${source.host}`]) rewritten = rewritten.replaceAll(`${origin}/`, "/");
  for (const [from, to] of compatibilityRewrites) rewritten = rewritten.replaceAll(from, to);
  return rewritten;
}

function localFileFor(url, contentType) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  if (contentType.includes("html") && path.posix.extname(pathname) === "") pathname = `${pathname}/index.html`;
  if (pathname === "") pathname = "/index.html";
  const safeSegments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[<>:"\\|?*\u0000-\u001f]/gu, "_"));
  return path.join(...safeSegments);
}

function isTextContent(contentType, relativeFile) {
  return contentType.startsWith("text/") || /(?:html|xml|json|javascript|svg|manifest)/u.test(contentType) || /\.(?:html?|css|js|mjs|json|xml|svg|txt|md)$/iu.test(relativeFile);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function parseArgs(args) {
  const parsed = { source: "https://krypton-lang.org/", output: "site", concurrency: 6, clean: true, verbose: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--source") parsed.source = requireValue(args, ++index, arg);
    else if (arg === "--output") parsed.output = requireValue(args, ++index, arg);
    else if (arg === "--concurrency") parsed.concurrency = Number(requireValue(args, ++index, arg));
    else if (arg === "--no-clean") parsed.clean = false;
    else if (arg === "--verbose") parsed.verbose = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/sync-site.mjs [--source URL] [--output DIR] [--concurrency N] [--no-clean] [--verbose]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(parsed.concurrency) || parsed.concurrency < 1 || parsed.concurrency > 20) {
    throw new Error("--concurrency must be integer between 1 and 20");
  }
  return parsed;
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires value`);
  return value;
}

import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const siteRoot = path.resolve(process.argv[2] || "site");
const sourceOrigin = "https://krypton-lang.org";
const errors = [];
const files = await walk(siteRoot);
const fileSet = new Set(files.map((file) => toPosix(path.relative(siteRoot, file))));

if (!fileSet.has("index.html")) errors.push("site/index.html missing");
if (fileSet.size < 10) errors.push(`mirror unexpectedly small (${fileSet.size} files)`);

for (const absoluteFile of files) {
  const relativeFile = toPosix(path.relative(siteRoot, absoluteFile));
  if (!/\.(?:html?|css|js|mjs|json|xml|svg|txt|md)$/iu.test(relativeFile)) continue;

  const text = await readFile(absoluteFile, "utf8");
  const references = [];
  const attributePattern = /\b(?:href|src|poster|data-src|action|formaction)\s*=\s*(["'])(.*?)\1/giu;
  for (const match of text.matchAll(attributePattern)) references.push(match[2]);
  if (/\.css$/iu.test(relativeFile)) {
    for (const match of text.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/giu)) references.push(match[2]);
  }

  for (const rawReference of references) {
    const reference = rawReference.trim();
    if (!reference || reference.includes("${") || /\s\+\s/u.test(reference)) continue;
    if (reference.startsWith(`${sourceOrigin}/`) || reference.startsWith("//krypton-lang.org/")) {
      errors.push(`${relativeFile}: clearnet same-origin URL not rewritten: ${reference}`);
      continue;
    }
    if (!isLocalReference(reference)) continue;

    const resolved = new URL(reference, `https://mirror.invalid/${relativeFile}`);
    const candidates = localCandidates(resolved.pathname);
    if (!candidates.some((candidate) => fileSet.has(candidate))) {
      errors.push(`${relativeFile}: missing local target ${reference}`);
    }
  }
}

try {
  const report = JSON.parse(await readFile(path.join(siteRoot, "mirror-report.json"), "utf8"));
  if (report.failures?.length) errors.push(`mirror report contains ${report.failures.length} failed download(s)`);
} catch (error) {
  errors.push(`cannot read mirror-report.json: ${error instanceof Error ? error.message : error}`);
}

if (errors.length) {
  console.error(`Mirror verification failed with ${errors.length} problem(s):`);
  for (const error of errors.slice(0, 50)) console.error(`- ${error}`);
  if (errors.length > 50) console.error(`- ...and ${errors.length - 50} more`);
  process.exitCode = 1;
} else {
  console.log(`Mirror verified: ${fileSet.size} files; discovered local references resolve.`);
}

async function walk(directory) {
  await access(directory);
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(absolute) : [absolute];
    }),
  );
  return nested.flat();
}

function isLocalReference(reference) {
  return Boolean(reference) && !reference.startsWith("#") && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(reference);
}

function localCandidates(pathname) {
  const decoded = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (!decoded || decoded.endsWith("/")) return [`${decoded}index.html`];
  const candidates = [decoded];
  if (path.posix.extname(decoded) === "") candidates.push(`${decoded}.html`, `${decoded}/index.html`);
  return candidates;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

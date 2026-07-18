import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

await import("./sync-site.mjs");

const siteRoot = path.resolve("site");
const reportPath = path.join(siteRoot, "mirror-report.json");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const source = new URL(report.source);
const discovered = new Set();

for (const entry of report.files) {
  if (!entry.file.endsWith(".html")) continue;
  const html = await readFile(path.join(siteRoot, entry.file), "utf8");
  const metadataImage = /<meta\b[^>]*(?:property|name)=["'](?:og:image(?::[^"']*)?|twitter:image(?::[^"']*)?)["'][^>]*content=["']([^"']+)["'][^>]*>/giu;
  for (const match of html.matchAll(metadataImage)) discovered.add(match[1]);
}

for (const reference of discovered) {
  const url = new URL(reference, source);
  if (url.origin !== source.origin) continue;
  const relativeFile = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (!relativeFile || relativeFile.includes("..")) throw new Error(`Unsafe metadata asset path: ${reference}`);

  const response = await fetch(url, { headers: { "user-agent": "KryptonOnionMirror/1.0 (+https://krypton-lang.org/)" } });
  if (!response.ok) throw new Error(`Metadata asset ${url.href} returned HTTP ${response.status}`);
  const absoluteFile = path.join(siteRoot, relativeFile);
  await mkdir(path.dirname(absoluteFile), { recursive: true });
  await writeFile(absoluteFile, Buffer.from(await response.arrayBuffer()));

  if (!report.files.some((entry) => entry.file === relativeFile)) {
    report.files.push({ url: url.href, file: relativeFile });
  }
  console.log(`saved ${relativeFile} (metadata)`);
}

report.files.sort((a, b) => a.file.localeCompare(b.file));
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

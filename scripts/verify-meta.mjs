import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const siteRoot = path.resolve(process.argv[2] || "site");
const report = JSON.parse(await readFile(path.join(siteRoot, "mirror-report.json"), "utf8"));
const source = new URL(report.source);
const errors = [];

for (const entry of report.files) {
  if (!entry.file.endsWith(".html")) continue;
  const html = await readFile(path.join(siteRoot, entry.file), "utf8");
  const metadataImage = /<meta\b[^>]*(?:property|name)=["'](?:og:image(?::[^"']*)?|twitter:image(?::[^"']*)?)["'][^>]*content=["']([^"']+)["'][^>]*>/giu;
  for (const match of html.matchAll(metadataImage)) {
    const url = new URL(match[1], source);
    if (url.origin !== source.origin) continue;
    const relativeFile = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    try {
      await access(path.join(siteRoot, relativeFile));
    } catch {
      errors.push(`${entry.file}: missing metadata image ${match[1]}`);
    }
  }
}

if (errors.length) {
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Metadata images verified.");
}

import { cp, mkdir, copyFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "dist");
const files = [
  "index.html",
  "app.js",
  "styles.css",
  "supabase-config.js",
  "manifest.webmanifest",
  "service-worker.js",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of files) {
  await copyFile(resolve(root, file), resolve(output, file));
}

await copyFile(resolve(root, "tracking/vigia.js"), resolve(output, "vigia.js"));
await cp(resolve(root, "icons"), resolve(output, "icons"), { recursive: true });

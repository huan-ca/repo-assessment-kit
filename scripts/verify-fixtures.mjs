import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, "fixtures", "ecosystems", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const seen = new Set();

for (const fixture of manifest.fixtures) {
  if (seen.has(fixture.ecosystem)) throw new Error(`duplicate ecosystem: ${fixture.ecosystem}`);
  seen.add(fixture.ecosystem);
  for (const relativePath of fixture.files) {
    if (path.isAbsolute(relativePath) || relativePath.includes("..")) {
      throw new Error(`unsafe fixture path: ${relativePath}`);
    }
    await access(path.join(root, "fixtures", "ecosystems", relativePath));
  }
}
if (seen.size !== 7) throw new Error(`expected seven ecosystem fixtures, found ${seen.size}`);
console.log("seven ecosystem fixture roots verified");

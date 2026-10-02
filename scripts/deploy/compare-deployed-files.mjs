import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Compare the actual deployed source, not successful (possibly noop) workflow runs.
export function changedDeployedFiles(sourceRoot, liveRoot) {
  const changed = [];
  function walk(relative = "") {
    for (const entry of readdirSync(path.join(sourceRoot, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile()) {
        const live = path.join(liveRoot, name);
        if (!existsSync(live) || !readFileSync(path.join(sourceRoot, name)).equals(readFileSync(live)))
          changed.push(name);
      }
      else throw new Error(`Unsupported archive member: ${name}`);
    }
  }
  walk();
  return changed.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , sourceRoot, liveRoot, output] = process.argv;
  if (!sourceRoot || !liveRoot || !output) throw new Error("Expected source root, live root, output manifest");
  const changed = changedDeployedFiles(sourceRoot, liveRoot);
  writeFileSync(output, changed.join("\n") + (changed.length ? "\n" : ""));
  console.log(`Verified ${changed.length} actual deployed source changes`);
}

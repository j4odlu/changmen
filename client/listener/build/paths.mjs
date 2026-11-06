import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const listenerRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
export const repoRoot = path.resolve(listenerRoot, "../..");
export const outputDir = path.join(listenerRoot, "build/dist");
export const cacheDir = path.join(listenerRoot, "build/.cache");
export const reportsDir = path.join(listenerRoot, "build/.reports");

/** @param {string} parent @param {string} child */
export function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** No output may escape this new application, including through an existing junction/symlink. */
export function assertIsolatedPaths() {
  const realRepo = fs.realpathSync(repoRoot);
  if (fs.realpathSync(listenerRoot) !== path.join(realRepo, "client", "listener"))
    throw new Error("Listener source root must not be a symlink or junction");
  for (const target of [outputDir, cacheDir, reportsDir]) {
    let current = target;
    while (current !== listenerRoot) {
      if (fs.existsSync(current)) {
        if (!contains(listenerRoot, fs.realpathSync(current)) || fs.lstatSync(current).isSymbolicLink())
          throw new Error(`Unsafe listener output: ${target}`);
      }
      current = path.dirname(current);
    }
    if (!contains(listenerRoot, target) || target === listenerRoot) throw new Error("Invalid listener output");
  }
}

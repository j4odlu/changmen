import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** Verify the installed compiler's native binary and its actual install lifecycle. */
export function verifyInstalledEsbuild(root, installLog, { optional = false } = {}) {
  const require = createRequire(path.join(root, "server/backend/package.json"));
  try {
    require.resolve("esbuild");
  } catch (error) {
    const absent = error.code === "MODULE_NOT_FOUND"
      && require.resolve.paths("esbuild").every(directory => !fs.existsSync(path.join(directory, "esbuild")));
    if (optional && absent) return { installed: false, nativeExecuted: false };
    throw error;
  }
  assert.match(require("esbuild").transformSync("const value: number = 42", { loader: "ts" }).code, /value = 42/);
  assert.match(installLog, /esbuild@.*postinstall/, "Installed esbuild lifecycle must execute");
  return { installed: true, nativeExecuted: true };
}

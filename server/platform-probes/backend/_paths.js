import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BACKEND_ROOT, CHANGMEN_ROOT } from "@changmen/storage/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const RESOLVE_PATHS = [
  path.join(BACKEND_ROOT, "node_modules"),
  path.join(CHANGMEN_ROOT, "node_modules"),
];

export { BACKEND_ROOT };

export function reqS(...segments) {
  const entry = `@changmen/shared/${segments.join("/")}`;
  return require(require.resolve(entry, { paths: RESOLVE_PATHS }));
}

export function backendRequire(specifier) {
  return require(require.resolve(specifier, { paths: RESOLVE_PATHS }));
}

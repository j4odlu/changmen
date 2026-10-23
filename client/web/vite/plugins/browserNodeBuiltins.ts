import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../..");

function resolveFromRepo(specifier: string): string {
  try {
    return require.resolve(specifier);
  }
  catch {
    return require.resolve(specifier, { paths: [REPO_ROOT] });
  }
}

/** Node 全局兼容用于仍依赖 buffer / process 的浏览器依赖（如 mqtt）。 */
export function browserNodeBuiltins(): Plugin {
  const bufferEntry = resolveFromRepo("buffer/");
  const processBrowser = resolveFromRepo("process/browser.js");
  return {
    name: "changmen-browser-node-builtins",
    enforce: "pre",
    config() {
      return {
        resolve: {
          alias: [
            { find: /^buffer$/, replacement: bufferEntry },
            { find: /^process$/, replacement: processBrowser },
          ],
        },
        optimizeDeps: {
          include: [
            "buffer",
            "process",
          ],
          esbuildOptions: {
            define: {
              global: "globalThis",
            },
          },
        },
        define: {
          global: "globalThis",
        },
        build: {
          commonjsOptions: {
            transformMixedEsModules: true,
          },
        },
      };
    },
  };
}

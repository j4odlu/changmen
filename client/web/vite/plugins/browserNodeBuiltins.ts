import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import type { Plugin as EsbuildPlugin } from "esbuild";

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

/**
 * Vite 6+ 将 Node 内置 `buffer` / `process` 在浏览器侧 externalize 为空壳。
 * `@polymarket/builder-relayer-client` → ethers v5 → bn.js 访问 `buffer.Buffer` 会报：
 * Module "buffer" has been externalized for browser compatibility.
 *
 * 证据：Vite troubleshooting「module-externalized-for-browser-compatibility」；
 * polyfill 使用仓库已有传递依赖 `buffer` / `process`（mqtt 等引入）。
 * builder-signing-sdk 的 HMAC 单独替换为浏览器实现，开发预编译与生产构建一致。
 */
export function browserNodeBuiltins(): Plugin {
  const bufferEntry = resolveFromRepo("buffer/");
  const processBrowser = resolveFromRepo("process/browser.js");
  const builderHmacPath = path.resolve(REPO_ROOT, "client/web/src/polyfills/builderSigningHmac.ts");
  const sdkHmacModule = /[\\/]@polymarket[\\/]builder-signing-sdk[\\/]dist[\\/]signing[\\/]hmac\.js$/;
  const builderHmacPrebundle: EsbuildPlugin = {
    name: "changmen-builder-signing-browser-hmac",
    setup(build) {
      build.onLoad({ filter: sdkHmacModule }, () => ({
        contents: readFileSync(builderHmacPath, "utf8"),
        loader: "ts",
        resolveDir: path.dirname(builderHmacPath),
      }));
    },
  };

  return {
    name: "changmen-browser-node-builtins",
    enforce: "pre",
    resolveId(source, importer) {
      const isSdkHmacImport = /^\.\/hmac(?:\.js)?$/.test(source)
        && importer != null
        && /[\\/]@polymarket[\\/]builder-signing-sdk[\\/]dist[\\/]signing[\\/]index\.js$/.test(importer);
      if (!isSdkHmacImport && !sdkHmacModule.test(source))
        return;
      // Keep the SDK API and signature encoding; replace only its Node-only helper.
      // Node consumers continue to use the original SDK, with no global crypto alias.
      return builderHmacPath;
    },
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
            "@polymarket/builder-relayer-client",
          ],
          esbuildOptions: {
            plugins: [builderHmacPrebundle],
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

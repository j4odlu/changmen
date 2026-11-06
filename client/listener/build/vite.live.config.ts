/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import path from "node:path";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import { browserNodeBuiltins } from "../../web/vite/plugins/browserNodeBuiltins";
import { backendPublicAssets } from "../../web/vite/plugins/backendPublicAssets";
import { acyclicChunks } from "../../web/vite/plugins/acyclicChunks";
import { venueManualChunk } from "../../web/vite/venueChunks";
import { assertIsolatedPaths, cacheDir, listenerRoot, outputDir, repoRoot } from "./paths.mjs";
import { liveAliases } from "./liveAliases";
import { liveGraph } from "./liveGraph";
import { localBootstrap } from "./localBootstrap";
import { listenerAuthReturn, listenerEnvironment, listenerRouter } from "./listenerCompatibility";
assertIsolatedPaths();
export function listenerConfig(production = false) { return defineConfig({
  root: path.join(listenerRoot, "module"),
  base: production ? "/" : "/listener/",
  publicDir: false, envDir: path.join(repoRoot, "client/web"), envPrefix: "VITE_",
  cacheDir: path.join(cacheDir, "live"),
  resolve: { extensions: [".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"], alias: liveAliases, dedupe: ["vue", "pinia", "vue-router"] },
  plugins: [...(production ? [] : [listenerEnvironment()]), listenerRouter(), listenerAuthReturn(), browserNodeBuiltins(), backendPublicAssets(), vue(),
    AutoImport({ resolvers: [ElementPlusResolver({ importStyle: "css" })], dts: false }),
    Components({ resolvers: [ElementPlusResolver({ importStyle: "css" })], dts: false }), acyclicChunks(), liveGraph(), ...(production ? [] : [localBootstrap()])],
  // The unchanged local Vite server must treat emitted bundles as dependencies, not
  // rerun its source auto-import resolvers against minified Element Plus internals.
  build: { outDir: outputDir, assetsDir: production ? "assets/listener" : "node_modules/listener-assets", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: venueManualChunk } } },
  test: { root: listenerRoot, include: ["tests/**/*.test.ts"], environment: "node", cache: false,
    setupFiles: ["../web/src/test/vitestPolyfillLocalStorage.ts"], reporters: ["default"] },
}); }
export default listenerConfig();

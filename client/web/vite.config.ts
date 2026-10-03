/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { visualizer } from "rollup-plugin-visualizer";
import AutoImport from "unplugin-auto-import/vite";
import Components from "unplugin-vue-components/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import fs from "node:fs";
import https from "node:https";
import tls from "node:tls";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { browserNodeBuiltins } from "./vite/plugins/browserNodeBuiltins";
import { backendPublicAssets } from "./vite/plugins/backendPublicAssets";
import { matcherDevRedirect } from "./vite/plugins/matcherDevRedirect";
import {
  VENUE_ADAPTER_REL,
  VENUE_ADAPTER_ROOT,
} from "../../server/storage/paths.js";

const elementPlusResolver = ElementPlusResolver({ importStyle: "css" });

const WEB_ROOT = fileURLToPath(new URL(".", import.meta.url));
const CLIENT_CORE_SRC = path.resolve(WEB_ROOT, "../../packages/client-core/src");
const venueAdapterVitestGlob = path
  .relative(WEB_ROOT, VENUE_ADAPTER_ROOT)
  .split(path.sep)
  .join("/");
const clientCoreVitestGlob = path
  .relative(WEB_ROOT, path.resolve(WEB_ROOT, "../../packages/client-core"))
  .split(path.sep)
  .join("/");

// Windows：避开 Hyper-V/WSL 动态保留段（3560 曾落入 3513-3612 → EACCES）；Linux/VPS 仍用 3456
const DEV_API_PORT = process.platform === "win32" ? 3700 : 3456;
// Hyper-V/WSL 常保留 5123-5222（含 Vite 默认 5173/5174）
const DEFAULT_DEV_PORT = process.platform === "win32" ? 5274 : 5174;

type DevProxyOpts = {
  target: string;
  changeOrigin: boolean;
  ws?: boolean;
  secure?: boolean;
  agent?: https.Agent;
};

/** 远端 HTTPS（mTLS）时 Vite 代理须带本机客户端证书，CN 须与登录用户名一致 */
function buildHttpsClientAgent(env: Record<string, string>): https.Agent | undefined {
  const certPath = String(env.VITE_API_PROXY_TLS_CERT || "").trim();
  const keyPath = String(env.VITE_API_PROXY_TLS_KEY || "").trim();
  if (!certPath || !keyPath)
    return undefined;
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.warn(`[vite] VITE_API_PROXY_TLS_CERT/KEY 文件不存在，跳过 mTLS agent`);
    return undefined;
  }
  const caPath = String(env.VITE_API_PROXY_TLS_CA || "").trim();
  // 勿只用自建 CA 覆盖信任库：生产 changmen.fun 是 Let's Encrypt，单独 ca= 会报
  // unable to get local issuer certificate。自建 CA 时追加到系统根证书。
  const caExtra = caPath && fs.existsSync(caPath) ? fs.readFileSync(caPath) : null;
  return new https.Agent({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
    ...(caExtra
      ? { ca: [...tls.rootCertificates, caExtra] }
      : {}),
  });
}

function withProxyTarget(
  target: string,
  opts: { ws?: boolean; agent?: https.Agent } = {},
): DevProxyOpts {
  const isHttps = /^https:/i.test(target);
  return {
    target,
    changeOrigin: true,
    ws: opts.ws,
    secure: isHttps,
    ...(isHttps && opts.agent ? { agent: opts.agent } : {}),
  };
}
const INTENTIONAL_MIXED_IMPORTS = [
  "/src/api/chat.ts",
  "/src/runtime/collectors.ts",
  "/src/stores/account/balanceRefresh.ts",
  "/src/stores/accountStore.ts",
  "/src/stores/loseOrderStore.ts",
  "/src/stores/messageStore.ts",
  "/src/stores/userStore.ts",
];

function sharedVenueChunk(id: string): string | undefined {
  // client-core / monorepo shared 被各 venue 共用
  if (
    id.includes("packages/arb-core")
    || id.includes("@changmen/arb-core")
    || id.includes("packages/client-core")
    || id.includes("@changmen/client-core")
    || id.includes("packages/shared")
    || id.includes("@changmen/shared")
    || id.includes("packages/api-contract")
    || id.includes("@changmen/api-contract")
  ) {
    return "venue-shared";
  }
  // socket.io 同时被 venue-shared/socket 与各平台 WS 使用；落到单一平台 chunk 会与
  // venue-shared 形成循环依赖（Cannot access 'O' before initialization 白屏）。
  if (
    id.includes("node_modules/socket.io-client")
    || id.includes("node_modules/engine.io-client")
    || id.includes("node_modules/socket.io-parser")
  ) {
    return "venue-shared";
  }
  return undefined;
}

function venueChunkName(id: string): string | undefined {
  // Workspace 内嵌依赖也属于 node_modules，交给 Rollup 分包，不能误归为场馆源码。
  if (id.replace(/\\/g, "/").includes("/node_modules/"))
    return undefined;
  const marker = `${VENUE_ADAPTER_REL.replace(/\\/g, "/")}/`;
  const idx = id.replace(/\\/g, "/").indexOf(marker);
  if (idx === -1)
    return undefined;
  const rest = id.slice(idx + marker.length);
  const dir = rest.split(/[/\\]/)[0];
  if (!dir || dir === "registry" || dir === "adaptation") return undefined;
  if (dir === "shared" || dir === "contract") return "venue-shared";
  return `venue-${dir}`;
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "");
  const apiTarget = String(env.VITE_API_PROXY || process.env.VITE_API_PROXY || "")
    .trim()
    .replace(/\/+$/, "")
    || `http://127.0.0.1:${DEV_API_PORT}`;
  const DEV_PORT = Number(env.VITE_DEV_PORT || process.env.VITE_DEV_PORT) || DEFAULT_DEV_PORT;
  const mtlsAgent = /^https:/i.test(apiTarget) ? buildHttpsClientAgent(env) : undefined;
  const hkRelayTarget = String(env.VITE_HK_RELAY_ORIGIN || env.VITE_PM_HK_RELAY_ORIGIN || "").trim().replace(/\/+$/, "");

  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(apiTarget)) {
    console.log(`[vite] remote API proxy → ${apiTarget}${mtlsAgent ? " (mTLS client cert)" : " (no VITE_API_PROXY_TLS_*; login may fail if site requires client cert)"}`);
  }

  const proxy: Record<string, DevProxyOpts> = {};
  if (hkRelayTarget) {
    // 场馆 HK 出海 relay：dev 同源走 Vite 代理到香港 VPS，避免浏览器跨域 OPTIONS 到 3560 / 外网 IP
    const relayAgent = /^https:/i.test(hkRelayTarget) ? mtlsAgent : undefined;
    proxy["/esport/http-relay"] = withProxyTarget(hkRelayTarget, { agent: relayAgent });
    proxy["/esport/ws-forward/PM-MARKET"] = withProxyTarget(hkRelayTarget, { ws: true, agent: relayAgent });
    proxy["/esport/ws-forward/PM-SPORT-MARKET"] = withProxyTarget(hkRelayTarget, { ws: true, agent: relayAgent });
    proxy["/esport/ws-forward/PM-USER"] = withProxyTarget(hkRelayTarget, { ws: true, agent: relayAgent });
    proxy["/esport/ws-forward/PREDICTFUN-MARKET"] = withProxyTarget(hkRelayTarget, { ws: true, agent: relayAgent });
    proxy["/esport/ws-forward/SXBET-MARKET"] = withProxyTarget(hkRelayTarget, { ws: true, agent: relayAgent });
  }
  else {
    // 纯本机或分拆 hub：Market WS 独立 origin（须在通用 /esport 代理之前）
    const pmHubPort = Number(env.VITE_PM_MARKET_HUB_PORT || process.env.PM_MARKET_HUB_PORT || 3457);
    const pmHubTarget = String(env.VITE_PM_MARKET_HUB_ORIGIN || "").trim().replace(/\/+$/, "")
      || `http://127.0.0.1:${Number.isFinite(pmHubPort) && pmHubPort > 0 ? pmHubPort : 3457}`;
    proxy["/esport/ws-forward/PM-MARKET"] = withProxyTarget(pmHubTarget, { ws: true });

    const pmSportHubPort = Number(env.VITE_PM_SPORT_MARKET_HUB_PORT || process.env.PM_SPORT_MARKET_HUB_PORT || 3459);
    const pmSportHubTarget = String(env.VITE_PM_SPORT_MARKET_HUB_ORIGIN || "").trim().replace(/\/+$/, "")
      || `http://127.0.0.1:${Number.isFinite(pmSportHubPort) && pmSportHubPort > 0 ? pmSportHubPort : 3459}`;
    proxy["/esport/ws-forward/PM-SPORT-MARKET"] = withProxyTarget(pmSportHubTarget, { ws: true });

    const pfHubPort = Number(env.VITE_PREDICTFUN_MARKET_HUB_PORT || process.env.PREDICTFUN_MARKET_HUB_PORT || 3458);
    const pfHubTarget = String(env.VITE_PREDICTFUN_MARKET_HUB_ORIGIN || "").trim().replace(/\/+$/, "")
      || `http://127.0.0.1:${Number.isFinite(pfHubPort) && pfHubPort > 0 ? pfHubPort : 3458}`;
    proxy["/esport/ws-forward/PREDICTFUN-MARKET"] = withProxyTarget(pfHubTarget, { ws: true });

    const sxHubPort = Number(env.VITE_SXBET_MARKET_HUB_PORT || process.env.SXBET_MARKET_HUB_PORT || 3460);
    const sxHubTarget = String(env.VITE_SXBET_MARKET_HUB_ORIGIN || "").trim().replace(/\/+$/, "")
      || `http://127.0.0.1:${Number.isFinite(sxHubPort) && sxHubPort > 0 ? sxHubPort : 3460}`;
    proxy["/esport/ws-forward/SXBET-MARKET"] = withProxyTarget(sxHubTarget, { ws: true });
  }
  proxy["/esport2"] = withProxyTarget(apiTarget, { ws: true, agent: mtlsAgent });
  proxy["/esport"] = withProxyTarget(apiTarget, { ws: true, agent: mtlsAgent });
  proxy["/common"] = withProxyTarget(apiTarget, { ws: true, agent: mtlsAgent });
  proxy["/api"] = withProxyTarget(apiTarget, { ws: true, agent: mtlsAgent });
  proxy["/matcher"] = withProxyTarget(apiTarget, { ws: true, agent: mtlsAgent });
  proxy["/auth"] = withProxyTarget(apiTarget, { agent: mtlsAgent });
  proxy["/health"] = withProxyTarget(apiTarget, { agent: mtlsAgent });
  proxy["/v4.0"] = withProxyTarget(apiTarget, { ws: true, agent: mtlsAgent });

  return {
  base: "/",
  plugins: [
    // 须靠前：alias/optimizeDeps 影响 builder-relayer-client 预构建
    browserNodeBuiltins(),
    backendPublicAssets(),
    vue(),
    AutoImport({
      resolvers: [elementPlusResolver],
      // production build 勿写 dts：Windows 上与并行的 vite dev 抢 components.d.ts 会 EUNKNOWN
      dts: command === "build" ? false : path.resolve(WEB_ROOT, "auto-imports.d.ts"),
    }),
    Components({
      resolvers: [elementPlusResolver],
      dts: command === "build" ? false : path.resolve(WEB_ROOT, "components.d.ts"),
    }),
    matcherDevRedirect(),
    mode === "analyze"
      ? visualizer({
          filename: "dist/stats.html",
          gzipSize: true,
          brotliSize: true,
          open: false,
        })
      : undefined,
  ],
  resolve: {
    // platform_adapter 同目录常有 .ts（Vite）与 .js（Node CJS）并存，须优先 .ts
    extensions: [".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@changmen/client-core": CLIENT_CORE_SRC,
      "@changmen/venue-adapter": VENUE_ADAPTER_ROOT,
      mqtt: fileURLToPath(new URL("../../node_modules/mqtt", import.meta.url)),
      "socket.io-client": fileURLToPath(
        new URL("../../node_modules/socket.io-client", import.meta.url),
      ),
      "socketcluster-client": fileURLToPath(
        new URL("../../node_modules/socketcluster-client", import.meta.url),
      ),
    },
  },
  build: {
    // venue adapters 按平台目录分包；shared/registry/contract 留在主包。
    // 阈值按当前最大单平台 chunk 留余量。
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      onwarn(warning, warn) {
        const message = warning.message ?? "";
        if (
          message.includes("node_modules/element-plus/node_modules/@vueuse/core/dist/index.js")
          && message.includes("contains an annotation that Rollup cannot interpret")
        ) {
          return;
        }
        const isIntentionalMixedImport = INTENTIONAL_MIXED_IMPORTS.some((file) =>
          message.includes(file),
        );
        if (
          isIntentionalMixedImport
          && message.includes("is dynamically imported by")
          && message.includes("but also statically imported by")
        ) {
          return;
        }
        warn(warning);
      },
      output: {
        manualChunks(id) {
          const shared = sharedVenueChunk(id);
          if (shared) return shared;
          const venueChunk = venueChunkName(id);
          if (venueChunk) return venueChunk;
          // 让 Rollup 自行处理 node_modules 分块；手动 vendor 拆包会和
          // platform-all 形成循环 chunk，在浏览器里触发 TDZ 白屏。
          return undefined;
        },
      },
    },
  },
  server: {
    port: DEV_PORT,
    // 登录存储按 origin 隔离；重复启动应报错，不能悄悄换端口。
    strictPort: true,
    proxy,
  },
  test: {
    setupFiles: ["src/test/vitestPolyfillLocalStorage.ts", "src/test/vitestSetupCore.ts"],
    include: [
      "src/**/*.{test,spec}.{js,mjs,ts}",
      `${venueAdapterVitestGlob}/**/*.{test,spec}.{js,mjs,ts}`,
      `${venueAdapterVitestGlob}/**/shared/**/*.{test,spec}.{js,mjs,ts}`,
      `${clientCoreVitestGlob}/src/**/*.{test,spec}.{js,mjs,ts}`,
    ],
  },
  };
});

#!/usr/bin/env node
/**
 * 扫描 client/web 内 @changmen/venue-adapter/* 引用，供 package.json exports 与 PATH_REGISTRY 核对。
 *
 * 用法：
 *   node packages/venue-adapter/scripts/list-web-venue-imports.mjs
 *   node packages/venue-adapter/scripts/list-web-venue-imports.mjs --check
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const WEB_SRC = path.join(REPO_ROOT, "client", "web", "src");
const PKG = "@changmen/venue-adapter";
const CHECK = process.argv.includes("--check");

/** web 允许的顶层 barrel（非 mock 业务 import 应落在此） */
const BARREL_TOPS = new Set([
  "adaptation",
  "contract",
  "dex",
  "hg",
  "ob",
  "pb",
  "polymarket",
  "predictfun",
  "ray",
  "registry",
  "shared",
  "stake",
]);

/**
 * vitest 须 mock 子模块以免 barrel 拉起整包（如 polymarketAdapter）。
 * 仅测试文件可使用下列深路径。
 */
const MOCK_ONLY_DEEP = new Set([
  "polymarket/gtc",
  "polymarket/orderSettlement",
  "polymarket/settlementJob",
  "polymarket/orders",
  "polymarket/marketDelay",
  "shared/rejectWait",
]);

/** 运行时单点深 import（避免 registry barrel 拉起全平台 adapters） */
const RUNTIME_DEEP = new Map([
  // [changmen 扩展] 仅此迁移测试验证旧公共报价入口与新包共享状态。
  ["runtime/venueBrowserAccountRuntimeCompatibility.test.ts", new Set(["polymarket/pmArbPriceBufferMode"])],
  // [changmen 扩展] 轻量已保存偏好入口与仅动态加载的影子消费者；不开放整个深路径目录。
  ["runtime/pmDynamicWsPreflight.ts", new Set(["polymarket/pmFokPreflightMode"])],
  ["runtime/pmDynamicWsPreflight.test.ts", new Set(["polymarket/pmFokPreflightMode"])],
  ["components/user/tabs/PmBookSettings.vue", new Set(["polymarket/pmFokPreflightMode"])],
  ["components/user/tabs/UserDiagExtensionsTab.test.ts", new Set(["polymarket/pmFokPreflightMode"])],
  ["runtime/pmMarketData.ts", new Set(["polymarket/orderBookSource"])],
  ["runtime/pmMarketData.test.ts", new Set(["polymarket/orderBookSource"])],
  // [changmen 扩展] 公共套利按 PM 单腿模式懒加载 GTC；兼容桥只封装原单身份。
  ["orderModes/gtc/arbLeg.ts", new Set(["polymarket/gtc", "polymarket/orders"])],
  ["stores/account/betGateway.ts", new Set(["polymarket/gtc"])],
  // [changmen 扩展] 独立 PM 监控承接原 GTC 核对；编排入口不再读场馆。
  ["runtime/gtcOrderMonitor/pm.ts", new Set(["polymarket/gtc"])],
  ["runtime/gtcOrderMonitor/pmPolling.ts", new Set(["polymarket/gtc"])],
  ["orderModes/gtc/manual.ts", new Set(["polymarket/gtc", "polymarket/orders"])],
  ["orderModes/gtc/gateway.ts", new Set(["polymarket/gtc"])],
  ["orderModes/gtc/orderCardView.ts", new Set(["polymarket/gtc"])],
  ["orderModes/gtc/pollingPolicy.ts", new Set(["polymarket/gtc"])],
  ["orderModes/gtc/sellFinancials.ts", new Set(["polymarket/gtc"])],
  ["orderModes/gtc/financialOrder.ts", new Set(["polymarket/orders"])],
  // [changmen 扩展] 订单盘口名复用 PM 原生元数据缓存，不从合场 Map 推断。
  ["orderModes/gtc/orderDisplayProjection.ts", new Set(["polymarket/orders"])],
  ["runtime/venueAdapters.ts", new Set(["registry/adapters"])],
  // vitest setup → oddsStore：勿经 polymarket/predictfun barrel 预加载 CLOB transport，否则场馆单测 vi.mock 失效
  ["stores/oddsStore.ts", new Set([
    "polymarket/pmArbPriceBufferMode",
    "predictfun/pfArbPriceBufferMode",
  ])],
]);

const IMPORT_RE = new RegExp(
  `(?:from|import)\\s*(?:\\(?\\s*)?["']${PKG}/([^"']+)["']`,
  "g",
);
const DYNAMIC_RE = new RegExp(
  `import\\s*\\(\\s*["']${PKG}/([^"']+)["']\\s*\\)`,
  "g",
);
const MOCK_RE = new RegExp(
  `vi\\.mock\\s*\\(\\s*["']${PKG}/([^"']+)["']`,
  "g",
);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory())
      walk(p, out);
    else if (/\.(ts|vue|tsx)$/.test(name))
      out.push(p);
  }
  return out;
}

const subs = new Set();
const deepViolations = [];

for (const file of walk(WEB_SRC)) {
  const text = fs.readFileSync(file, "utf8");
  const isTest = /\.(test|spec)\.(ts|tsx)$/.test(file);
  for (const re of [IMPORT_RE, DYNAMIC_RE, MOCK_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const sub = m[1];
      subs.add(sub);
      const top = sub.split("/")[0];
      const isDeep = sub.includes("/");
      if (isDeep) {
        if (MOCK_ONLY_DEEP.has(sub) && isTest)
          continue;
        const rel = path.relative(WEB_SRC, file).replace(/\\/g, "/");
        const allowed = RUNTIME_DEEP.get(rel);
        if (allowed?.has(sub))
          continue;
        if (!MOCK_ONLY_DEEP.has(sub) || !isTest)
          deepViolations.push({ file, sub });
      }
      else if (!BARREL_TOPS.has(top)) {
        deepViolations.push({ file, sub });
      }
    }
  }
}

const sorted = [...subs].sort();
const roots = new Set(sorted.map((s) => s.split("/")[0]));
console.log(`${PKG} subpaths from client/web/src (${sorted.length}, ${roots.size} top-level):`);
for (const sub of sorted) {
  console.log(`  ./${sub}`);
}

if (CHECK) {
  if (deepViolations.length) {
    console.error("\nlist-web-venue-imports --check: 非 barrel / 非法深路径 import：");
    for (const v of deepViolations)
      console.error(`  ${path.relative(process.cwd(), v.file)} → ./${v.sub}`);
    process.exit(1);
  }
  console.log("\nlist-web-venue-imports --check: OK");
}

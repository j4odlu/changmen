import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { rebasePmFokImports } from "./pm-fok-source-relocation.mjs";
import { restorePmOrderBetLabelSource } from "./pm-order-bet-label-boundary.mjs";
import { restorePmTickRefreshSource } from "./pm-tick-refresh-boundary.mjs";
import { restorePmPreflightSource } from "./pm-preflight-boundary.mjs";

// [changmen 扩展] 精确登记本次纯位置迁移；旧入口只能再导出，核验仍读取完整实现。
export const PM_FUNCTIONAL_GROUPS = Object.freeze({
  "auth": ["credentials", "l2Auth", "profile"],
  "wallet": ["balance", "contracts", "depositWallet", "polygonRpc", "relayer", "sessionBuilderConfig", "walletPrepUnified", "pmWalletPrepSdk"],
  "transport": ["api", "transport", "pmTransport", "pmTransportMode", "pmAutoTransport", "pmOfficialReachability", "pmRoutingPreference", "pmPublicRoute"],
  "markets": ["collect", "marketIndex", "parse", "parseEsportsScore", "pmFootballDiscovery", "pmSportGamma", "pmSportGuard", "pmMarketGuard", "pmMapOutcomeStore"],
  "quotes": ["marketQuoteHub", "sportQuoteHub", "pmTokenQuote", "priceQuote", "pmTickBuffer", "pmTickMetadata", "pmTickPrice", "pmTickState", "pmArbPriceBufferMode"],
  "realtime": ["ws", "wsConfig", "wsQuotes", "sportMarketWs", "sportWsConfig", "userWs", "userWsMessages", "pmMarketWsMode", "pmUserWsMode", "pmWsSourceMode"],
  "orders": ["pmClientApi", "pmFee"],
  "orders/facts": ["orderStatus", "orderTypes", "pmPostFillOrder", "pmTradeHashes", "tradeFailure"],
  "orders/history": ["orders", "pmActivity", "pmActivityV2", "pmStoredOrders", "pmOrderSync"],
  "orders/confirmation": ["legOutcome", "marketDelay", "pmHeartbeat"],
  "orders/positions": ["pmLogicalPosition", "pmOrigin"],
  "submission": ["pmManualSell"],
  "submission/preflight": ["pmBetGuard", "pmDetection", "pmMarketOrderOptions", "pmStake", "pmBuyOrderShares"],
  "submission/client": ["builder", "pmBrowserSubmitClock", "pmOrderClientCache", "pmOrderSubmitMode"],
  "submission/recovery": ["pmSubmitJournal", "pmUnknownSubmitRecovery"],
  "diagnostics": ["orderTrace", "pmExecutionMetrics", "pmMarketClientMetrics"],
});
for (const files of Object.values(PM_FUNCTIONAL_GROUPS))
  Object.freeze(files);

const root = "packages/venue-adapter/polymarket";
export const PM_FUNCTIONAL_RELOCATIONS = Object.freeze(Object.fromEntries(
  Object.entries(PM_FUNCTIONAL_GROUPS).flatMap(([group, files]) => files.map(name => [
    `${root}/${name}.ts`,
    `${root}/${group}/${name}.ts`,
  ])),
));

export function pmFunctionalCompatibilitySource(file) {
  const target = PM_FUNCTIONAL_RELOCATIONS[file];
  assert(target, `No PM functional relocation registered: ${file}`);
  const relative = path.posix.relative(path.posix.dirname(file), target).replace(/\.ts$/, "");
  return `// [changmen 扩展] 保留原入口；实现按功能迁移，所有调用共享同一模块与状态。\nexport * from "./${relative}";\n`;
}

export function readRelocatedPmFunctionalSource(file, source, readSource = target => fs.readFileSync(target, "utf8")) {
  const target = PM_FUNCTIONAL_RELOCATIONS[file];
  if (!target)
    return source.replace(/\r\n/g, "\n");
  assert.equal(source.replace(/\r\n/g, "\n"), pmFunctionalCompatibilitySource(file), `${file}: compatibility entry must only re-export its registered implementation`);
  return rebasePmFokImports(restorePmTickRefreshSource(target, restorePmOrderBetLabelSource(target, restorePmPreflightSource(target, readSource(target)), readSource)), target, file).replace(/\r\n/g, "\n");
}

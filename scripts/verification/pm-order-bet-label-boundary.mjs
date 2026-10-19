import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { restorePmStoredSettlementSource } from "./pm-stored-settlement-boundary.mjs";
import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";

// [changmen 扩展] 用户要求订单盘口名来自 PM；只登记名称来源及补元数据查询，原执行/财务基线保留。
export const PM_ORDER_LABEL_HELPER = "packages/venue-adapter/polymarket/markets/orderBetLabel.ts";
const helperSha = "d3453cfff2259b0ba199f8e04e1334325459762e864406c24101c46d376bbdc6";
const root = "packages/venue-adapter/polymarket/";
const normalize = source => source.replace(/\r\n/g, "\n");
function replace(source, before, after = "", count = 1) {
  assert.equal(source.split(before).length - 1, count, `PM order label exact boundary: ${before}`);
  return source.split(before).join(after);
}

/** 验证登记的新模块，然后精确恢复名称差异，供完整旧源码比较；其它语句仍逐字受保护。 */
export function restorePmOrderBetLabelSource(file, input, read) {
  let source = restorePmStoredSettlementSource(file, normalize(input));
  if (file === "client/web/src/orderModes/gtc/arbLeg.ts" && source.includes("lookupPolymarketOrderBetLabel")) {
    assert.equal(createHash("sha256").update(restoreVenueBrowserExecution(PM_ORDER_LABEL_HELPER, normalize(read(PM_ORDER_LABEL_HELPER)))).digest("hex"), helperSha, "exact PM order label helper");
    source = replace(source, 'import { lookupPolymarketOrderBetLabel } from "@changmen/venue-adapter/polymarket/orders";\n');
    return replace(source, 'bet: lookupPolymarketOrderBetLabel(pm.betId, pm.itemId) || "盘口待核实", item: pm.target', "bet: params.bet.getBetName(), item: pm.target");
  }
  if (!["markets/marketIndex.ts", "markets/parse.ts", "orders/history/orders.ts", "orders/facts/pmPostFillOrder.ts"].some(name => file === root + name))
    return source;
  const changed = source.includes("orderBetLabel") || source.includes('if (type === "child_moneyline" || !type)');
  if (!changed)
    return source;
  assert.equal(createHash("sha256").update(restoreVenueBrowserExecution(PM_ORDER_LABEL_HELPER, normalize(read(PM_ORDER_LABEL_HELPER)))).digest("hex"), helperSha, "exact PM order label helper");
  if (file.endsWith("/marketIndex.ts")) {
    source = replace(source, 'import { rememberPolymarketIndexBetLabel } from "./orderBetLabel";\n');
    return replace(source, "    rememberPolymarketIndexBetLabel(entry);\n");
  }
  if (file.endsWith("/parse.ts")) {
    source = replace(source, 'if (type === "child_moneyline" || !type)', 'if (type === "child_moneyline")');
    return replace(source, `  // [changmen 扩展] CLOB 历史市场不带 Gamma 的盘口类型；只解析明确的电竞全场标题。
  if (!type && mapPolymarketGameId(market) && /\\bvs\\.?\\s+.+\\(BO\\d+\\)/i.test(text)
    && !/\\b(?:total|handicap|spread|over|under|kills)\\b/i.test(text))
    return 0;
`);
  }
  if (file.endsWith("/pmPostFillOrder.ts")) {
    source = replace(source, 'import { lookupPolymarketOrderBetLabel } from "../../markets/orderBetLabel";\n');
    return replace(source, 'bet: lookupPolymarketOrderBetLabel(option.betId, option.itemId) || "盘口待核实"', 'bet: option.bet?.getBetName?.() ?? option.bet?.name ?? ""');
  }
  source = replace(source, 'import { lookupPolymarketOrderBetLabel, rememberPolymarketMarketBetLabel } from "../../markets/orderBetLabel";\n\nexport { lookupPolymarketOrderBetLabel } from "../../markets/orderBetLabel";\n');
  source = replace(source, "bet: lookupPolymarketOrderBetLabel(clob.pmConditionId, clob.pmTokenId) || clob.bet || base.bet", "bet: base.bet || clob.bet", 2);
  source = replace(source, "merged.push({ ...storedVenueOrderToUsdc(stored), bet: lookupPolymarketOrderBetLabel(stored.pmConditionId, stored.pmTokenId) || stored.bet });", "merged.push(storedVenueOrderToUsdc(stored));");
  source = replace(source, "  rememberPolymarketMarketBetLabel(market);\n");
  source = replace(source, "  lookbackMs = ORDER_LOOKBACK_MS,\n  storedOrders: VenueOrder[] = [],\n", "  lookbackMs = ORDER_LOOKBACK_MS,\n");
  source = replace(source, `  // [changmen 扩展] 增量成交窗口以外的存量订单也补 PM 盘口名称；已知元数据不重复查询。
  const missingLabels = storedOrders.filter(order => !lookupPolymarketOrderBetLabel(order.pmConditionId, order.pmTokenId));
`);
  source = replace(source, '[...preview.map(trade => String(trade.market ?? "")), ...missingLabels.map(order => String(order.pmConditionId ?? ""))].filter(Boolean)', 'preview.map(trade => String(trade.market ?? "")).filter(Boolean)');
  source = replace(source, '[...preview.map(trade => String(trade.asset_id ?? "")), ...missingLabels.map(order => String(order.pmTokenId ?? ""))].filter(Boolean)', 'preview.map(trade => String(trade.asset_id ?? "")).filter(Boolean)');
  return replace(source, "await fetchPolymarketVenueOrdersBundle(account, lookbackMs, stored)", "await fetchPolymarketVenueOrdersBundle(account, lookbackMs)");
}

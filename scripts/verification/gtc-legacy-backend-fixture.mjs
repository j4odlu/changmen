// [changmen 扩展] 真实历史读/合组/归账/DTO/分区及新同步链路；存储与账号采用离线夹具，无真实 I/O。
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { historicalMinimal } from "./historical-order-storage.mjs";
const { minimalClientOrder } = historicalMinimal;
import { gitSource } from "./fok-exact-boundaries.mjs";
import { pmMakerAmountUsdc, validatePmSubmission } from "../../packages/shared/pm_submission.ts";
export const legacyBusinessFiles = ["server/backend/core/orderModes/readOrders.js", "server/backend/core/orderModes/identity.js",
  ...["link", "group_home", "kinds", "date_key", "dto"].map(name => `server/backend/core/account/order/${name}.js`)];
export function loadOfflineModule(file, source, require, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, module: { exports }, require, console, Error, Date, Map, Set, Number, JSON, structuredClone, ...globals }, { filename: file });
  return exports;
}
export async function legacyBackendScenario(source, { repeatedGroup = false, rebound = false, lateFill = false } = {}) {
  const at = Date.UTC(2026, 9, 8, 23, 59), id = "11111111-1111-1111-1111-111111111111";
  const record = { id, owner: "owner", createdAt: at, financialOrder: { pmShares: 10 },
    plan: { playerId: 1, otherPlayerId: 2, otherProvider: "RAY", orderHash: "buy", linkId: at, shares: "10", match: "m", bet: "b", item: "i" },
    matched: "10", principal: "5", fee: "0", observedAt: at,
    fills: { one: { key: "one", tradeId: "one", bucket: "maker", role: "MAKER", shares: "10", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: at } },
    orderId: "buy", other: { orderId: null, submittedAt: 0 } };
  const ledgerAt = rebound ? at - 30 * 86400000 : at;
  const rows = Array.from({ length: repeatedGroup ? 5001 : 1 }, (_, index) => ({ user_id: "owner", player_id: 1, provider: "Polymarket",
    order_id: index ? `sell-${index}` : "buy", link: ledgerAt, create_at: lateFill ? at + 20 * 86400000 : at + index, status: "Win",
    raw: { pmGtcExecutionId: id, pmSide: index ? "sell" : "buy", ...(index ? { pmBuyOrderId: "buy" } : {}) } }));
  const cache = new Map(), trace = [];
  const db = {
    minimalClientOrder,
    placeholderLinkFromCreateAt: time => Number(time),
    fetchOrdersByExecutionPage: async (date, owner, mode, _anchors, pageIndex, pageSize) => {
      assert.equal(owner, "owner"); assert.equal(mode, "GTC"); assert.equal(pageSize, 5000);
      const candidates = date === get("date_key").toDateKey(ledgerAt) ? rows : [];
      return { rows: candidates.slice((pageIndex - 1) * pageSize, pageIndex * pageSize), total: candidates.length };
    },
    fetchOrdersByLinks: async (owner, links) => { assert.equal(owner, "owner"); return rows.filter(row => links.includes(row.link)); },
    fetchOrdersByUserOrderIds: async (owner, ids) => { assert.equal(owner, "owner"); return rows.filter(row => ids.includes(row.order_id)); },
    fetchPredictionSellsByBuyOrderIds: async (owner, ids) => { assert.equal(owner, "owner"); return rows.filter(row => ids.includes(row.raw.pmBuyOrderId)); },
  };
  function get(name) {
    const file = name === "readOrders" || name === "identity" ? `server/backend/core/orderModes/${name}.js` : `server/backend/core/account/order/${name}.js`;
    if (!cache.has(file)) cache.set(file, loadOfflineModule(file, source(file), target => {
      if (target === "@changmen/db") return db;
      if (target === "@changmen/shared/pm_submission") return { pmMakerAmountUsdc, validatePmSubmission };
      if (target.endsWith("/order_store.js")) return { attachPlayerDisplayToClientOrders: async rows => rows };
      if (target.endsWith("/pf_fee.js")) return { computePfHoldShares: () => undefined };
      if (target.endsWith("/position_events.js")) return { readPositionSellEvents: () => [] };
      return get(target.split("/").at(-1).replace(/\.js$/, ""));
    }));
    return cache.get(file);
  }
  const helperFile = "client/web/src/orderModes/gtc/legacyMonitorOrders.ts";
  const helper = loadOfflineModule(helperFile, gitSource("adb333bf24b6ba6aa3e441009b56f874a23f6ed9", helperFile), () => { throw new Error("helper runtime import"); });
  let restored, error;
  try {
    restored = await helper.readLegacyGtcMonitorOrders([id], async (action, body) => {
      trace.push({ action, ...body });
      if (action === "Pm_GtcList") return [record];
      assert.equal(action, "Pm_GtcOrders");
      return get("readOrders").readOrdersForMode(body, "owner", "GTC", [record]);
    });
  } catch (e) { error = e.message; }
  return { restored, error, trace, ledgerDate: get("date_key").toDateKey(ledgerAt), record, ledgerRaw: rows[0], financialOriginal: get("dto").toClientOrder(rows[0]) };
}
export async function modernMonitorOrdersScenario(record, rawOrder, financialOriginal) {
  const file = "server/backend/core/orderModes/gtc/orders.js";
  const reads = [];
  const api = loadOfflineModule(file, fs.readFileSync(file, "utf8"), target => target === "@changmen/db" ? {
    listPmGtcByIds: async (owner, ids) => { assert.equal(owner, record.owner); assert.equal(JSON.stringify(ids), JSON.stringify([record.id])); return [record]; },
    fetchOrdersByPlayerOrderIdsStrict: async (player, owner, ids) => {
      assert.equal(player, record.plan.playerId); assert.equal(owner, record.owner); assert.equal(JSON.stringify(ids), JSON.stringify([rawOrder.order_id]));
      reads.push({ player, owner, ids }); return [rawOrder];
    },
  } : target.endsWith("/order/dto.js") ? { toClientOrder: () => financialOriginal } : {});
  return { rows: await api.getGtcMonitorOrders({ ids: [record.id] }, record.owner), reads };
}

/** [changmen 扩展] 当前前端 -> 真实 action/handler/原单查询/DTO；本地状态、数据库及此读取场景的财务显示助手用固定夹具。 */
export async function exactMonitorApiScenario(record, rawOrders, { failRead = false, changeSession = false, resultPending = false, backendSource = file => fs.readFileSync(file, "utf8") } = {}) {
  const cache = new Map(), trace = []; let current = true;
  const db = {
    minimalClientOrder,
    listPmGtcByIds: async (owner, ids) => {
      trace.push({ read: "executions", owner, ids });
      assert.equal(owner, record.owner); assert.equal(JSON.stringify(ids), JSON.stringify([record.id])); return [record];
    },
    fetchOrdersByPlayerOrderIdsStrict: async (player, owner, ids) => {
      trace.push({ read: "originals", player, owner, ids });
      assert.equal(owner, record.owner);
      if (failRead) throw new Error("ledger unavailable");
      if (changeSession) current = false;
      return rawOrders.filter(row => String(row.player_id) === String(player) && row.user_id === owner && ids.some(id => id.toLowerCase() === row.order_id.toLowerCase()));
    },
  };
  const forbidden = () => { throw new Error("Unexpected trading, ordinary orders or database mutation"); };
  function get(file) {
    if (!cache.has(file)) cache.set(file, loadOfflineModule(file, file.startsWith("server/") ? backendSource(file) : fs.readFileSync(file, "utf8"), target => {
      if (target === "@changmen/db") return new Proxy(db, { get: (object, key) => object[key] ?? forbidden });
      if (target === "@/api/client") return {
        getAuthSessionVersion: () => "session", isAuthSessionCurrent: () => current,
        post: async (action, body) => { trace.push({ action, body }); return get("server/backend/core/esport-api/pm_pf_routes.ts").handlePmPfAction(action, body, { user: { id: record.owner } }); },
        unwrap: response => { if (response.success !== 1) throw new Error(response.msg); return response.info; },
      };
      if (target.endsWith("/gtc/handler.js")) return get("server/backend/core/orderModes/gtc/handler.js");
      if (file.endsWith("/gtc/ordersApi.ts") && target === "./api") return { listGtc: async () => { trace.push({ read: "local-executions" }); return [record]; } };
      if (file.endsWith("/gtc/ordersApi.ts") && target === "./localStore") return { pendingGtcResults: async () => resultPending ? [{ result: { executionId: record.id } }] : [] };
      if (target === "./confirmedResult") return get("client/web/src/orderModes/gtc/confirmedResult.ts");
      if (target === "./financialOrder") return get("client/web/src/orderModes/gtc/financialOrder.ts");
      if (target === "@changmen/shared/pm_gtc") return get("packages/shared/pm_gtc.ts");
      if (target === "@changmen/venue-browser/adapter/polymarket" || target === "@changmen/venue-adapter/polymarket") return { buildPolymarketMatchedBuyVenueOrderUsdc: (_id, facts, options) => ({ pmShares: Number(facts.takingAmount), pmFillPrice: .5, pmStakeUsdc: options.fallbackStakeUsdc + options.feeUsdc, pmFeeUsdc: options.feeUsdc, odds: 2, betMoney: options.fallbackStakeUsdc + options.feeUsdc }) };
      if (target === "@changmen/venue-browser/adapter/polymarket/orders" || target === "@changmen/venue-adapter/polymarket/orders") return { scalePolymarketVenueOrdersForDisplay: rows => rows };
      if (file.endsWith("/gtc/handler.js") && target === "./results.js") return get("server/backend/core/orderModes/gtc/results.js");
      if (target.endsWith("/player_ownership.js")) return { assertPlayerOwnedByUser: async (player, owner) => ({ ok: player === record.plan.playerId && owner === record.owner, player: { provider: "Polymarket" } }) };
      if (file.endsWith("/gtc/handler.js") && target === "./orders.js") return get("server/backend/core/orderModes/gtc/orders.js");
      if (target.endsWith("/order/dto.js")) return get("server/backend/core/account/order/dto.js");
      if (target === "@changmen/shared/pm_submission") return { pmMakerAmountUsdc, validatePmSubmission };
      if (file.endsWith("/order/dto.js") && target === "./kinds.js") return get("server/backend/core/account/order/kinds.js");
      if (target.endsWith("/pf_fee.js")) return { computePfHoldShares: () => undefined };
      if (target.endsWith("/position_events.js")) return { readPositionSellEvents: () => [] };
      return new Proxy({}, { get: () => forbidden });
    }));
    return cache.get(file);
  }
  let rows, error;
  try { rows = await get("client/web/src/orderModes/gtc/ordersApi.ts").loadGtcMonitorOrders([record.id]); }
  catch (e) { error = e.message; }
  return { rows, error, trace };
}

/** [changmen 扩展] 真实同步消费器/action/结果校验；本地队列、账号和结果库为离线边界，禁止交易及执行表写入。 */
export async function confirmedResultSyncScenario(source, { fault = "" } = {}) {
  const hash = `0x${"a".repeat(64)}`, id = "11111111-1111-4111-8111-111111111111";
  const result = { executionId: id, orderId: hash, playerId: 1, linkId: -100, createdAt: 1, revision: 4,
    match: "m", bet: "b", item: "i", tokenId: "t", conditionId: "c", buyShares: "3.000001", principalUsdc: "1.5", feeUsdc: "0",
    fills: [{ key: "trade:maker", tradeId: "trade", bucket: "maker", role: "MAKER", shares: "3.000001", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 1 }],
    financial: { pmShares: 3.000001, pmFillPrice: .5, pmStakeUsdc: 1.5, pmFeeUsdc: 0, odds: 2, betMoney: 1.5 * 6.7 } };
  if (fault === "process") result.pmAuthorized = true;
  if (fault === "intermediate") result.fills[0].status = "MINED";
  if (fault === "financial") result.financial.betMoney = 100;
  const trace = [], cache = new Map(), entry = { result, at: 0 }, issues = {};
  const forbidden = () => { throw new Error("Unexpected trading or execution control dependency"); };
  function get(file) {
    if (!cache.has(file)) cache.set(file, loadOfflineModule(file, source(file), target => {
      if (target === "@changmen/shared/pm_gtc") return get("packages/shared/pm_gtc.ts");
      if (target === "@changmen/shared/currency") return get("packages/shared/currency.ts");
      if (target === "@changmen/db") return new Proxy({
        resolveGtcFinancialOrder: (...args) => get("server/db/rds/orderModes/gtc/pm_gtc_financial.js").resolveGtcFinancialOrder(...args),
        savePmGtcConfirmedResult: async (owner, saved) => { assert.equal(owner, "owner"); assert.equal(JSON.stringify(saved), JSON.stringify(result)); trace.push({ save: "confirmed-result" }); return fault === "ack" ? false : true; },
      }, { get: (object, key) => object[key] ?? forbidden });
      if (target === "vue") return { watch: () => () => {} };
      if (target === "@/api/client") return {
        getAuthSessionVersion: () => "session", isAuthSessionCurrent: () => true,
        post: async (action, body) => { trace.push({ action }); return get("server/backend/core/esport-api/pm_pf_routes.ts").handlePmPfAction(action, body, { user: { id: "owner" } }); },
        unwrap: response => { if (response.success !== 1) throw new Error(response.msg); return response.info; },
      };
      if (target.endsWith("/localStore")) return { listLocalGtc: async () => [], localGtcChanges: { revision: 0 }, listenLocalGtcChanges: () => () => {},
        pendingGtcResults: async owner => { assert.equal(owner, "owner"); return [entry]; },
        finishGtcResult: async (saved, retry) => { assert.equal(saved, entry); trace.push({ finish: retry ? "retry" : "acknowledged" }); } };
      if (target.endsWith("/gtcProgressState")) return { gtcProgress: { saveIssues: issues } };
      if (target.endsWith("/syncStatus")) return { gtcSyncIssue: error => error.message };
      if (target === "@/api/order") return { registerOrderSyncProjection: () => () => {} };
      if (target.endsWith("/gtc/handler.js")) return get("server/backend/core/orderModes/gtc/handler.js");
      if (file.endsWith("/gtc/handler.js") && target === "./results.js") return get("server/backend/core/orderModes/gtc/results.js");
      if (target.endsWith("/player_ownership.js")) return { assertPlayerOwnedByUser: async () => fault === "owner" ? { ok: false, msg: "foreign owner" } : { ok: true, player: { provider: "Polymarket" } } };
      return new Proxy({}, { get: () => forbidden });
    }, { setTimeout: () => 0, clearTimeout: () => {} }));
    return cache.get(file);
  }
  const sync = get("client/web/src/stores/account/gtcOrderSync.ts");
  sync.startGtcOrderSync("owner");
  try { await sync.flushGtcResults(); } finally { sync.stopGtcOrderSync(); }
  return { trace, issues, result };
}

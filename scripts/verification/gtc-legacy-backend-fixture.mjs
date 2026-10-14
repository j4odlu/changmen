// [changmen 扩展] 真实旧后端读/合组/归账/DTO/分区函数，只有数据库边界模拟；不触发真实 I/O。
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { minimalClientOrder } from "../../server/db/rds/pm_orders_minimal.js";
import { gitSource } from "./fok-exact-boundaries.mjs";
export const legacyBusinessFiles = ["server/backend/core/orderModes/readOrders.js", "server/backend/core/orderModes/identity.js",
  ...["link", "group_home", "kinds", "date_key", "dto"].map(name => `server/backend/core/account/order/${name}.js`)];
export function loadOfflineModule(file, source, require) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, module: { exports }, require, console, Error, Date, Map, Set, Number, JSON }, { filename: file });
  return exports;
}
export async function legacyBackendScenario(source, { repeatedGroup = false, rebound = false, lateFill = false } = {}) {
  const at = Date.UTC(2026, 9, 8, 23, 59), id = "11111111-1111-1111-1111-111111111111";
  const record = { id, owner: "owner", createdAt: at, financialOrder: { pmShares: 10 },
    plan: { playerId: 1, otherPlayerId: 2, otherProvider: "RAY", orderHash: "buy", linkId: at }, orderId: "buy", other: { orderId: null, submittedAt: 0 } };
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

/** [changmen 扩展] 当前前端 -> 真实 action -> 真实 handler -> 真实原单查询 -> 真实 DTO；只模拟库读取。 */
export async function exactMonitorApiScenario(record, rawOrders, { failRead = false, changeSession = false, backendSource = file => fs.readFileSync(file, "utf8") } = {}) {
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
      if (file.endsWith("/gtc/handler.js") && target === "./orders.js") return get("server/backend/core/orderModes/gtc/orders.js");
      if (target.endsWith("/order/dto.js")) return get("server/backend/core/account/order/dto.js");
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

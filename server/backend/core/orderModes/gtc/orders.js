import * as db from "@changmen/db";
import { toClientOrder } from "../../account/order/dto.js";
import * as orders from "../../account/order_store.js";
import { assertPlayerOwnedByUser } from "../../account/player_ownership.js";
import { verifyOrderExecution } from "../orderMetadata.js";
import { readOrdersForMode } from "../readOrders.js";
import { saveClientGtcOrders } from "./results.js";

/** [changmen 扩展] 仅返回认证用户持久化执行的 exact 原单，不依赖日期或前端提供的账号。 */
export async function getGtcMonitorOrders(body, owner, recoveredRecords) {
  if (!owner)
    throw new Error("请先登录");
  let ids = body.ids;
  if (typeof ids === "string") {
    try { ids = JSON.parse(ids); }
    catch { throw new Error("GTC 监控恢复身份无效"); }
  }
  if (!Array.isArray(ids) || ids.length > 1000 || ids.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
    throw new Error("GTC 监控恢复身份无效");
  if (!ids.length)
    return [];
  const requested = new Set(ids.map(id => id.toLowerCase()));
  const records = recoveredRecords ?? await db.listPmGtcByIds(owner, [...requested]);
  const accounts = new Map();
  for (const row of records) {
    if (row.owner !== owner || !requested.has(row.id))
      throw new Error("GTC 监控恢复执行归属无效");
    for (const [playerId, provider, orderId] of [[row.plan.playerId, "Polymarket", row.orderId], [row.plan.playerId, "Polymarket", row.plan.orderHash], [row.plan.otherPlayerId, row.plan.otherProvider, row.other.orderId]]) {
      if (!playerId || !orderId)
        continue;
      const list = accounts.get(playerId) ?? [];
      if (!list.some(anchor => anchor.provider === provider && anchor.orderId.toLowerCase() === orderId.toLowerCase() && anchor.executionId === row.id))
        list.push({ provider, orderId, executionId: row.id });
      accounts.set(playerId, list);
    }
  }
  const result = [];
  for (const [playerId, anchors] of accounts) {
    const orders = await db.fetchOrdersByPlayerOrderIdsStrict(playerId, owner, [...new Set(anchors.map(anchor => anchor.orderId))]);
    for (const order of orders) {
      if (String(order.player_id) !== String(playerId) || order.user_id !== owner)
        throw new Error("GTC 监控恢复订单账号归属无效");
      if (order.provider === "Polymarket" && order.raw?.pmSide === "sell")
        continue;
      const matching = new Set(anchors.filter(anchor => anchor.provider === order.provider && anchor.orderId.toLowerCase() === String(order.order_id).toLowerCase()).map(anchor => anchor.executionId));
      if (!matching.size)
        continue;
      const storedIdentity = order.raw?.pmGtcExecutionId ? String(order.raw.pmGtcExecutionId) : undefined;
      // [changmen 扩展] 保留可信库内身份；无身份旧行只有唯一 exact 关联才补返回标识，冲突保持查询问题。
      if (storedIdentity ? !matching.has(storedIdentity) : matching.size !== 1)
        throw new Error("GTC 监控恢复订单执行身份冲突，请核对原单归属");
      result.push({ ...toClientOrder(order), PmGtcExecutionId: storedIdentity ?? [...matching][0] });
    }
  }
  // [changmen 扩展] 已持久化的成交与财务买单同事务提交；缺失不能被解释为未成交或已成功恢复。
  for (const row of records) {
    if (Number(row.financialOrder?.pmShares) > 0 && !result.some(order => order.PmGtcExecutionId === row.id
      && String(order.PlayerID) === String(row.plan.playerId) && order.Type === "Polymarket")) {
      throw new Error("GTC 监控恢复原单财务记录缺失，请核对原单身份");
    }
  }
  return result;
}

export async function getGtcOrders(body, owner) {
  return readOrdersForMode(body, owner, "GTC", await db.listPmGtc(owner));
}

export async function saveGtcOrders(body, owner) {
  if (body.origins != null) return saveClientGtcOrders(body, owner);
  const playerId = Number(body.playerId);
  const owned = await assertPlayerOwnedByUser(playerId, owner);
  if (!owned.ok)
    return owned;
  let rows;
  try { rows = JSON.parse(body.orders || "[]"); }
  catch { return { ok: false, msg: "GTC orders JSON 无效" }; }
  if (!Array.isArray(rows))
    return { ok: false, msg: "GTC orders 必须为数组" };
  if (String(body.type || owned.player?.provider) === "PredictFun")
    return { ok: false, msg: "PredictFun 订单只允许服务端场馆路径写入" };
  if (rows.some(row => !row || typeof row.pmGtcExecutionId !== "string" || !row.pmGtcExecutionId))
    return { ok: false, msg: "GTC 原单执行身份或账号归属无效" };
  const records = await db.listPmGtcByIds(owner, [...new Set(rows.map(row => row.pmGtcExecutionId))]);
  const executions = new Map(records.map(row => [row.id, row]));
  const existing = await db.fetchOrdersByPlayerOrderIdsStrict(playerId, owner, rows.flatMap(row => [row.orderId, row.pmBuyOrderId ?? row.pfBuyOrderId].filter(Boolean)));
  const known = new Map(existing.map(row => [String(row.order_id).toLowerCase(), row.raw?.pmGtcExecutionId]));
  for (const row of rows) {
    const execution = executions.get(row.pmGtcExecutionId);
    if (!execution || ![execution.plan.playerId, execution.plan.otherPlayerId].some(id => Number(id) === playerId))
      return { ok: false, msg: "GTC 原单执行身份或账号归属无效" };
    const id = String(row.orderId ?? "").toLowerCase();
    const parent = String(row.pmBuyOrderId ?? row.pfBuyOrderId ?? "").toLowerCase();
    const anchor = Number(execution.plan.playerId) === playerId
      ? [execution.orderId, execution.plan.orderHash]
      : [execution.other.orderId];
    const knownAnchor = anchor.some(value => value && String(value).toLowerCase() === (parent || id)) || known.get(parent || id) === execution.id;
    const acceptedCounterpart = Number(execution.plan.otherPlayerId) === playerId && !execution.other.orderId
      && ["accepted", "pending", "filled"].includes(execution.other.state)
      && row.provider === execution.plan.otherProvider
      && row.venueMatchId === execution.plan.otherVenueMatchId && row.venueItemId === execution.plan.otherVenueItemId
      && Math.abs(Number(row.betMoney) - execution.plan.otherStake) < 0.01
      && Number(row.createAt) >= execution.other.submittedAt - 1000
      && Number(row.createAt) <= execution.other.submittedAt + 120000
      && Number(row.link) === execution.plan.linkId && !parent && rows.length === 1;
    if (!knownAnchor && !acceptedCounterpart)
      return { ok: false, msg: "GTC 保存必须匹配本执行原单" };
    verifyOrderExecution(row, execution.id);
  }
  const saved = await orders.saveOrder(playerId, rows, owner, body.type || "");
  return saved ? { ok: true, info: true } : { ok: false, msg: "GTC 保存订单失败" };
}

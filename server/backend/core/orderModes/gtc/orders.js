import * as db from "@changmen/db";
import { assertPlayerOwnedByUser } from "../../account/player_ownership.js";
import { readOrdersForMode } from "../readOrders.js";
import * as orders from "../../account/order_store.js";
import { verifyOrderExecution } from "../orderMetadata.js";

export async function getGtcOrders(body, owner) {
  return readOrdersForMode(body, owner, "GTC", await db.listPmGtc(owner));
}

export async function saveGtcOrders(body, owner) {
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

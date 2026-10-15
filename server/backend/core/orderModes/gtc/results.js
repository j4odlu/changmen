/** [changmen 扩展] 结果同步与精确财务读取；执行控制及监控过程不写 RDS。 */
import * as db from "@changmen/db";
import { mergeGtcFacts, createGtcExecution } from "@changmen/shared/pm_gtc";
import { assertPlayerOwnedByUser } from "../../account/player_ownership.js";
import { toClientOrder } from "../../account/order/dto.js";
import * as orderStore from "../../account/order_store.js";
import { verifyOrderExecution } from "../orderMetadata.js";

const uuid = value => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function validateGtcConfirmedResult(input, owner) {
  const allowed = new Set(["executionId", "orderId", "playerId", "linkId", "createdAt", "revision", "match", "bet", "item", "tokenId", "conditionId", "buyShares", "principalUsdc", "feeUsdc", "fills", "financial"]);
  const fillFields = new Set(["key", "tradeId", "bucket", "role", "shares", "price", "fee", "status", "updatedAt"]);
  if (!input || Object.keys(input).some(key => !allowed.has(key)) || !uuid(input.executionId)
    || typeof input.orderId !== "string" || !/^0x[0-9a-f]{64}$/i.test(input.orderId)
    || !Number.isSafeInteger(input.playerId) || input.playerId <= 0 || !Number.isSafeInteger(input.linkId)
    || !Number.isSafeInteger(input.revision) || input.revision < 0 || !Number.isFinite(input.createdAt) || input.createdAt <= 0
    || [input.match, input.bet, input.item, input.tokenId, input.conditionId].some(value => typeof value !== "string" || value.length > 10000)
    || !Array.isArray(input.fills) || !input.fills.length || input.fills.length > 10000
    || input.fills.some(fill => !fill || Object.keys(fill).some(key => !fillFields.has(key)) || !["CONFIRMED", "FAILED"].includes(fill.status) || (fill.status === "CONFIRMED" && fill.fee == null)))
    throw new Error("GTC 同步只能接收已确认订单结果");
  if (new Set(input.fills.map(fill => fill.key)).size !== input.fills.length) throw new Error("GTC 成交明细重复");
  const calculation = createGtcExecution(input.executionId, owner, "", "", { orderHash: input.orderId, shares: input.buyShares }, input.createdAt);
  const totals = mergeGtcFacts(calculation, { order: null, fills: input.fills, complete: true, observedAt: 0 });
  if (totals.matched !== input.buyShares || totals.principal !== input.principalUsdc || totals.fee !== input.feeUsdc
    || totals.error.split("；").some(error => error && error !== ""))
    throw new Error("GTC 已确认成交明细与结果不一致");
  const financial = db.resolveGtcFinancialOrder({ ...totals, orderId: input.orderId, complete: true }, input.financial);
  if (!financial || (financial.pmShares === 0 && !input.fills.some(fill => fill.status === "FAILED")))
    throw new Error("GTC 零成交意向不能建立财务订单");
  return { ...input, financial };
}
export async function syncGtcConfirmedResult(body, owner) {
  const result = validateGtcConfirmedResult(body.result, owner);
  const owned = await assertPlayerOwnedByUser(result.playerId, owner);
  if (!owned.ok || owned.player?.provider !== "Polymarket") throw new Error(owned.msg || "GTC 结果账号归属或场馆无效");
  return db.savePmGtcConfirmedResult(owner, result);
}
export async function readGtcConfirmedResults(body, owner) {
  const anchors = body.anchors;
  if (!Array.isArray(anchors) || anchors.length > 1000 || anchors.some(anchor => !uuid(anchor.executionId)
    || !Number.isSafeInteger(anchor.playerId) || anchor.playerId <= 0 || typeof anchor.provider !== "string"
    || typeof anchor.orderId !== "string" || !anchor.orderId.trim())) throw new Error("GTC 原单结果读取身份无效");
  const grouped = new Map();
  for (const anchor of anchors) { const list = grouped.get(anchor.playerId) ?? []; list.push(anchor); grouped.set(anchor.playerId, list); }
  const rows = [];
  for (const [playerId, originals] of grouped) {
    const owned = await assertPlayerOwnedByUser(playerId, owner); if (!owned.ok) throw new Error(owned.msg);
    for (const row of await db.fetchOrdersByPlayerOrderIdsStrict(playerId, owner, originals.map(anchor => anchor.orderId))) {
      if (Number(row.player_id) !== playerId || row.user_id !== owner) throw new Error("GTC 原单结果账号归属无效");
      const matching = originals.filter(anchor => anchor.provider === row.provider && anchor.orderId.toLowerCase() === String(row.order_id).toLowerCase());
      if (!matching.length || row.raw?.pmSide === "sell") continue;
      const ids = new Set(matching.map(anchor => anchor.executionId));
      if (ids.size !== 1 || (row.raw?.pmGtcExecutionId && !ids.has(row.raw.pmGtcExecutionId))) throw new Error("GTC 原单结果身份冲突");
      rows.push({ ...toClientOrder(row), PmGtcExecutionId: [...ids][0] });
    }
  }
  return rows;
}
/** [changmen 扩展] 已确认对侧原单和卖单仍走原订单合并器，身份由客户端持久原单提供。 */
export async function saveClientGtcOrders(body, owner) {
  const playerId = Number(body.playerId);
  const owned = await assertPlayerOwnedByUser(playerId, owner);
  if (!owned.ok) return owned;
  let rows;
  try { rows = JSON.parse(body.orders || "[]"); } catch { return { ok: false, msg: "GTC orders JSON 无效" }; }
  const origins = body.origins;
  if (!Array.isArray(rows) || !Array.isArray(origins) || origins.length !== rows.length)
    return { ok: false, msg: "GTC 原单结果身份缺失" };
  const existing = await db.fetchOrdersByPlayerOrderIdsStrict(playerId, owner, rows.flatMap(row => [row.orderId, row.pmBuyOrderId ?? row.pfBuyOrderId].filter(Boolean)));
  const bindings = [];
  for (const row of rows) {
    const origin = origins.find(anchor => anchor.orderId === (row.pmBuyOrderId ?? row.pfBuyOrderId ?? row.orderId)
      && anchor.executionId === row.pmGtcExecutionId && anchor.playerId === playerId && anchor.provider === row.provider);
    if (!origin || !uuid(origin.executionId) || row.provider === "PredictFun" || row.provider !== owned.player?.provider)
      return { ok: false, msg: "GTC 原单结果账号或执行身份无效" };
    const known = existing.find(old => String(old.order_id).toLowerCase() === String(origin.orderId).toLowerCase());
    if ((known?.raw?.pmGtcExecutionId && known.raw.pmGtcExecutionId !== origin.executionId)
      || (row.provider === "Polymarket" && known?.raw?.pmGtcExecutionId !== origin.executionId))
      return { ok: false, msg: "GTC 原单结果身份冲突或买单尚未同步" };
    if (row.provider !== "Polymarket" && known && !known.raw?.pmGtcExecutionId
      && db.isConfirmedClientBindLink(Number(known.link)) && Number(known.link) !== Number(row.link)) {
      const placeholder = db.isCreateAtPlaceholderLink(known.link, known.create_at)
        || db.isBackendBindPlaceholderLink(known.link, known.create_at)
        || db.isInsertTimePlaceholderLink(known.link, known.create_at) || db.isHashLink(known.link);
      if (!placeholder || !Number.isSafeInteger(row.link) || !row.link)
        return { ok: false, msg: "GTC 对侧原单已属于其他 Link，禁止自动改绑" };
      bindings.push({ OrderID: known.order_id, PlayerID: playerId, Provider: row.provider, LinkID: row.link });
    }
    verifyOrderExecution(row, origin.executionId);
  }
  // 普通合并器保护已有 Link；先沿用精确绑单入口修正占位，保存失败仍可由正常同步重试。
  if (bindings.length && !await orderStore.saveOrderBind(bindings, owner))
    return { ok: false, msg: "GTC 对侧原单关联失败，等待订单同步重试" };
  const saved = await orderStore.saveOrder(playerId, rows, owner, body.type || "");
  return saved ? { ok: true, info: true } : { ok: false, msg: "GTC 保存订单失败" };
}

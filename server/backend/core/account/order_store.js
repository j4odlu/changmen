import * as sb from "@changmen/db";
import { parseVenueCreateAt } from "@changmen/shared/time/match_time";
import { isAdminUser } from "../auth/admin_auth.js";
import { toDateKey } from "./order/date_key.js";
import {
  parseNum,
  rowToOrder,
  toClientOrder,
} from "./order/dto.js";
import { isPredictionSellForCount } from "./order/kinds.js";
import {
  betMoneyForProfitAggregate,
  dedupeOrdersByUserOrderId,
  moneyForProfitAggregate,
} from "./order/profit_cny.js";
import {
  enrichOrdersBelongingToDate,
  findOrderRowById,
  resolveSaveOrderLink,
} from "./order/link.js";
import { mergeOtherProviderLogicalSave } from "./order/save_non_pm.js";
import { mergePredictFunLogicalSave } from "./order/save_pf.js";
import { mergePolymarketProviderSave } from "./order/save_pm.js";
import { applyPositionEventsOnSave } from "./order/position_events.js";

export { toDateKey } from "./order/date_key.js";
export {
  resolveStoredLink,
  resolvePfHoldSharesFromRaw,
  rowToOrder,
  scrubClientOrder,
  toClientOrder,
} from "./order/dto.js";
export { isPredictionSellForCount } from "./order/kinds.js";
export {
  alignRawPredictionSellLinksToBuys,
  enrichOrdersBelongingToDate,
  findOrderRowById,
  mergePredictionBuySellSiblings,
} from "./order/link.js";
export {
  applyPositionEventsOnSave,
  collectIncomingPositionSellEvents,
  normalizePositionSellEvent,
  readPositionSellEvents,
  upsertPositionSellEvents,
} from "./order/position_events.js";

function mapStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "win")
    return "Win";
  if (s === "lose")
    return "Lose";
  if (s === "reject")
    return "Reject";
  if (s === "return")
    return "Return";
  if (s === "pending")
    return "Pending";
  return "None";
}

/**
 * saveOrder 落库合并入口。
 * 三平行分支：Polymarket ‖ PredictFun ‖ 其它场馆。
 * （旧名 mergePolymarketLogicalSave：历史误导，已废弃不留别名。）
 * @internal 单测 / 手动卖出本金合并
 */
export function mergeOrderLogicalSave(prevRow, prevRaw, o, pmOrigin) {
  const provider = String(o.provider || o.Type || prevRow?.provider || "").trim();
  const merged = pmOrigin ? { ...o, pmOrigin } : { ...o };
  const money = parseNum(o.money ?? o.Money, 0);
  const bet_money = parseNum(o.betMoney ?? o.BetMoney, 0);

  let result;
  if (provider === "Polymarket") {
    result = mergePolymarketProviderSave(prevRow, prevRaw, o, pmOrigin, merged, money, bet_money);
  }
  else if (provider === "PredictFun") {
    result = mergePredictFunLogicalSave(prevRow, prevRaw, merged, money, bet_money);
  }
  else {
    result = mergeOtherProviderLogicalSave(merged, prevRaw, money, bet_money);
  }

  const sidePm = String(result.raw?.pmSide || o.pmSide || "").trim().toLowerCase();
  const sidePf = String(result.raw?.pfSide || o.pfSide || "").trim().toLowerCase();
  // 按 provider 判卖单行，避免 PF 买单误带 pmSide=sell 时剥掉 positionEvents
  const isSellRow = provider === "Polymarket"
    ? sidePm === "sell"
    : provider === "PredictFun"
      ? sidePf === "sell"
      : false;
  applyPositionEventsOnSave(result.raw, prevRaw || {}, o, { isSellRow });
  return result;
}

/**
 * [changmen 扩展] 工作台订单回填 Player 展示名（含已 soft-delete 账号）。
 * 对齐 admin attachPlayerDisplayToAdminOrders；A8 形状仍走 Player.Platform / UserName。
 */
export async function attachPlayerDisplayToClientOrders(list) {
  const orders = list || [];
  const ids = [...new Set(
    orders.map(o => Number(o?.PlayerID) || 0).filter(id => id > 0),
  )];
  if (!ids.length)
    return orders;
  const players = await sb.fetchPlayersByIdsIncludingDeleted(ids);
  const byId = new Map(players.map(p => [Number(p.id ?? p.playerId), p]));
  return orders.map((order) => {
    const p = byId.get(Number(order.PlayerID) || 0);
    if (!p)
      return order;
    const data
      = p.accountData && typeof p.accountData === "object" && !Array.isArray(p.accountData)
        ? p.accountData
        : {};
    const venueAccountName = String(data.venueAccountName || "").trim();
    const playerName = String(p.playerName || "").trim();
    const pid = Number(order.PlayerID) || 0;
    const userName = venueAccountName || playerName || (pid ? `#${pid}` : "");
    const platformName = String(p.platformName || "").trim();
    const deleted = p.deletedAt != null;
    return {
      ...order,
      Player: {
        ...(order.Player && typeof order.Player === "object" ? order.Player : {}),
        Platform: platformName || order.Player?.Platform || "",
        UserName: userName,
        Status: order.Player?.Status || "None",
      },
      PlayerDeleted: deleted || undefined,
    };
  });
}

export async function listByDate(date, userId) {
  const target = date || toDateKey(Date.now());
  const rows = await sb.fetchOrdersByDate(target, userId);
  return attachPlayerDisplayToClientOrders(rows.map(toClientOrder));
}

export async function listByDatePage(date, userId, pageIndex = 1, pageSize = 1024) {
  const target = date || toDateKey(Date.now());
  const page = Math.max(1, Number(pageIndex) || 1);
  const size = Math.max(1, Number(pageSize) || 1024);
  const { rows } = await sb.fetchOrdersByDatePage(target, userId, page, size);
  // [changmen 扩展] 同 Link + buyId 跨日并入；整组只留在 Link 开弓日
  const merged = await enrichOrdersBelongingToDate(rows || [], target, { userId });
  const list = await attachPlayerDisplayToClientOrders(merged.map(toClientOrder));
  return { list, total: list.length };
}

export async function listByPlayer(playerId, userId, opts = undefined) {
  const rows = await sb.fetchOrdersByPlayer(playerId, userId, opts);
  return rows.map(rowToOrder);
}

export async function saveOrder(playerId, orders, userId, typeFallback = "") {
  if (!userId || !Array.isArray(orders))
    return false;
  if (!orders.length)
    return true;
  const defaultProvider = String(typeFallback || "").trim();
  // [changmen 扩展] 允许 changmen 手动卖单落库（同 Link + pmBuyOrderId / pfBuyOrderId）
  const incoming = orders;
  if (!incoming.length)
    return true;
  const incomingResolved = incoming.map((o) => {
    const rawCreate = o.createAt ?? o.CreateAt;
    const parsed = parseVenueCreateAt(rawCreate, 0);
    const fallbackAt = parsed > 0 ? parsed : Date.now();
    const orderId = String(o.orderId || `${playerId}-${fallbackAt}`);
    return { o, orderId, parsed, fallbackAt };
  });
  const prefetchOrderIds = [];
  for (const { o, orderId } of incomingResolved) {
    prefetchOrderIds.push(orderId);
    const buyOrderId = String(
      o.pmBuyOrderId ?? o.PmBuyOrderId ?? o.pfBuyOrderId ?? o.PfBuyOrderId ?? "",
    ).trim();
    if (buyOrderId)
      prefetchOrderIds.push(buyOrderId);
  }
  // strict 回源既有单：读失败必须中止，否则会把"查询失败"当"无既有单"→当新单覆盖
  // pfLedgerState / pmOrigin / 卖单 proceeds / link 等账本状态（P0-4 D2）
  let existing;
  try {
    existing = await sb.fetchOrdersByPlayerOrderIdsStrict(playerId, userId, prefetchOrderIds);
  }
  catch (err) {
    console.error("[order] saveOrder 读既有订单失败，已中止保存以防覆盖账本:", err?.message);
    return false;
  }
  const linkByOrderId = new Map(
    existing.map(r => [String(r.order_id), Number(r.link) || 0]),
  );
  const existingByOrderId = new Map(
    existing.map(r => [String(r.order_id), r]),
  );

  const assignedInBatch = new Map();
  const rows = [];
  for (const { o, orderId, parsed, fallbackAt } of incomingResolved) {
    // 本单 prev：order_id 大小写不敏感；命中后 upsert 主键用库内形态，避免 ON CONFLICT 插出重复行
    const prevRow = findOrderRowById(existingByOrderId, orderId);
    const storedOrderId = prevRow?.order_id != null && String(prevRow.order_id).trim()
      ? String(prevRow.order_id).trim()
      : orderId;
    const prevAt = Number(prevRow?.create_at) || 0;
    // 已落库的 create_at 保持不变（SaveOrder 同步 / 场馆拉单不得覆盖），便于运维按日归账后不被写回
    const createAt = prevAt > 0 ? prevAt : (parsed > 0 ? parsed : fallbackAt);
    const prevRaw = prevRow?.raw && typeof prevRow.raw === "object" && !Array.isArray(prevRow.raw)
      ? prevRow.raw
      : {};
    // typeFallback（如 upsertPfServerOrder）必须进入 merge，否则 PF 保护/卖单 meta 会漏判
    const provider = String(o.provider || o.Type || defaultProvider || prevRow?.provider || "").trim();
    const orderForMerge = provider && !o.provider && !o.Type
      ? { ...o, provider }
      : o;
    const link = resolveSaveOrderLink(
      orderForMerge,
      prevRaw,
      orderId,
      createAt,
      linkByOrderId,
      existingByOrderId,
      assignedInBatch,
      provider,
    );
    assignedInBatch.set(orderId, link);
    if (storedOrderId !== orderId)
      assignedInBatch.set(storedOrderId, link);
    const incomingOrigin = o.pmOrigin;
    const prevOrigin = prevRaw.pmOrigin;
    let pmOrigin = incomingOrigin;
    if (prevOrigin === "changmen" && incomingOrigin === "external")
      pmOrigin = "changmen";
    else if (!pmOrigin)
      pmOrigin = prevOrigin || (provider === "Polymarket" ? "external" : undefined);
    const { raw, money, bet_money } = mergeOrderLogicalSave(
      prevRow,
      prevRaw,
      orderForMerge,
      pmOrigin,
    );
    rows.push({
      user_id: String(userId),
      player_id: Number(playerId),
      order_id: storedOrderId,
      link,
      provider,
      match: o.match || o.Match || "",
      bet: o.bet || o.Bet || "",
      item: o.item || o.Item || "",
      odds: parseNum(o.odds, 0),
      bet_money,
      money,
      status: mapStatus(raw.status ?? o.status ?? o.Status),
      create_at: createAt,
      raw,
    });
  }
  return rows.length ? await sb.upsertOrders(rows) : true;
}

function isUuidUserId(userId) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(userId ?? ""));
}

function stringToHashNumber(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function isSportsOrderRow(row) {
  const raw = row?.raw && typeof row.raw === "object" && !Array.isArray(row.raw)
    ? row.raw
    : {};
  return String(raw.domain || "").trim().toLowerCase() === "sports";
}

/** 排行榜：按登录用户聚合当日 orders；管理员及管理端配置排除的用户不参与。 */
export async function listUserProfitRank(dateKey = toDateKey(Date.now()), { includeExcluded = false } = {}) {
  const [dayOrders, profiles] = await Promise.all([
    sb.fetchOrdersForProfitAggregate(dateKey),
    sb.fetchProfiles(),
  ]);
  const esportDayOrders = (dayOrders || []).filter(o => !isSportsOrderRow(o));
  const userIds = [...new Set(
    esportDayOrders.map(o => String(o.user_id || "").trim()).filter(Boolean),
  )];
  const orders = (await enrichOrdersBelongingToDate(esportDayOrders, dateKey, { userIds }))
    .filter(o => !isSportsOrderRow(o));
  const adminIds = new Set(
    (profiles || []).filter(p => isAdminUser(p) || (!includeExcluded && p.leaderboard_excluded === true)).map(p => String(p.id)),
  );
  const nameById = new Map(
    (profiles || []).map(p => [String(p.id), String(p.user_name || "").trim()]),
  );
  const agg = new Map();
  for (const o of dedupeOrdersByUserOrderId(orders)) {
    const uid = String(o.user_id || "");
    if (!uid || adminIds.has(uid))
      continue;
    if (!agg.has(uid))
      agg.set(uid, { money: 0, count: 0, betMoney: 0 });
    const row = agg.get(uid);
    const status = String(o.status || "");
    if (status === "Reject")
      continue;
    // PF USDT→CNY：moneyForProfitAggregate（对齐前端当日盈亏）
    row.money += moneyForProfitAggregate(o);
    // 笔数 / 流水均不计 PM/PF 卖单；盈亏仍汇总该行（卖单 money 多为 0）
    if (!isPredictionSellForCount(o)) {
      row.count += 1;
      row.betMoney += betMoneyForProfitAggregate(o);
    }
  }
  const result = [];
  for (const [uid, stats] of agg) {
    if (adminIds.has(uid))
      continue;
    const userName = nameById.get(uid) || uid.slice(0, 8);
    result.push({
      UserID: stringToHashNumber(userName),
      UserName: userName,
      Money: stats.money,
      Count: stats.count,
      BetMoney: stats.betMoney,
      Date: dateKey,
    });
  }
  return result.sort((a, b) => b.Money - a.Money);
}

/** 解析 Client_SaveOrderBind 单行（对齐 A8 `nA`：LinkID + Provider + OrderID） */
export function parseOrderBindRow(row) {
  return {
    orderId: String(row?.orderId ?? row?.OrderID ?? ""),
    playerId: Number(row?.playerId ?? row?.PlayerID) || 0,
    linkId: Number(row?.linkId ?? row?.LinkID) || 0,
    provider: String(row?.Provider ?? row?.provider ?? ""),
  };
}

export async function saveOrderBind(orders, userId) {
  if (!userId || !Array.isArray(orders))
    return false;
  let ok = true;
  for (const raw of orders) {
    const { orderId, playerId, linkId, provider } = parseOrderBindRow(raw);
    if (!orderId || !linkId)
      continue;
    const updated = await sb.updateOrderBind(orderId, userId, linkId, {
      playerId,
      provider,
    });
    if (!updated)
      ok = false;
  }
  return ok;
}

/** [changmen 扩展] 侧栏手动改绑单笔 Link（新→老） */
export async function rebindOrderLink(userId, orderId, toLinkId) {
  return sb.rebindOrderLink(userId, orderId, toLinkId);
}

export function ensureSeed() {}

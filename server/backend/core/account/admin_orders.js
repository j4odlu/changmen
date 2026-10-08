/**
 * 管理端订单子域（列表 / 矩阵 / 日志 / 删除）。
 * 对外仍由 admin_service.js 原名 re-export，避免 router / 测例改 import。
 */
import * as sb from "@changmen/db";
import { lookupOrderLogs, toAdminOrderLogPayload } from "../admin_tools/user_log_lookup.js";
import { isAdminUser } from "../auth/admin_auth.js";
import { getVisibleUserIds, resolveVisibleUserIds } from "../auth/role_filter.js";
import {
  enrichOrdersBelongingToDate,
  resolveStoredLink,
  rowToOrder,
  toDateKey,
} from "./order_store.js";

function stripOrderHtml(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function orderMatchColumn(r) {
  const raw = r.raw && typeof r.raw === "object" && !Array.isArray(r.raw) ? r.raw : {};
  const matchId = Number(raw.matchId ?? raw.MatchId ?? raw.match_id ?? 0) || 0;
  const title = stripOrderHtml(r.match || raw.match || "");
  const key = matchId > 0 ? `id:${matchId}` : title ? `t:${title}` : `o:${r.id}`;
  return {
    key,
    matchId,
    label: title || (matchId > 0 ? `比赛 #${matchId}` : "—"),
    raw,
  };
}

function buildClientMatchStartIndex(clientMatches) {
  const byId = new Map();
  const byTitle = new Map();
  const list = Array.isArray(clientMatches) ? clientMatches : [];
  for (const m of list) {
    const id = Number(m.id ?? m.ID) || 0;
    const startTime = Number(m.start_time ?? m.StartTime) || 0;
    if (!startTime)
      continue;
    if (id)
      byId.set(id, startTime);
    const title = stripOrderHtml(m.title ?? m.Title ?? "");
    if (title && !byTitle.has(title))
      byTitle.set(title, startTime);
  }
  return { byId, byTitle };
}

function resolveMatchStartTime(col, startIndex) {
  const raw = col.raw || {};
  const fromRaw = Number(
    raw.startTime ?? raw.StartTime ?? raw.start_time ?? raw.matchStartTime ?? 0,
  ) || 0;
  if (fromRaw)
    return fromRaw;
  if (!startIndex)
    return 0;
  const byId = startIndex.byId instanceof Map ? startIndex.byId : null;
  const byTitle = startIndex.byTitle instanceof Map ? startIndex.byTitle : null;
  if (col.matchId && byId?.has(col.matchId)) {
    return byId.get(col.matchId);
  }
  if (col.label && byTitle?.has(col.label)) {
    return byTitle.get(col.label);
  }
  return 0;
}

export function mapAdminOrderRow(r, startIndex = null) {
  const col = orderMatchColumn(r);
  const safeStartIndex
    = startIndex
      && typeof startIndex === "object"
      && !Array.isArray(startIndex)
      && (startIndex.byId instanceof Map || startIndex.byTitle instanceof Map)
      ? startIndex
      : null;
  // 与工作台 rowToOrder 同源：卖单 Money 重算 + raw 内 Pm* 字段
  const o = rowToOrder(r);
  return {
    id: Number(r.id),
    userId: String(r.user_id),
    playerId: Number(o.PlayerID) || 0,
    orderId: String(o.OrderID || ""),
    linkId: Number(o.Link) || resolveStoredLink(r.link, r.order_id, r.create_at),
    provider: String(o.Type || ""),
    match: stripOrderHtml(o.Match || ""),
    bet: String(o.Bet || ""),
    item: String(o.Item || ""),
    odds: Number(o.Odds) || 0,
    betMoney: Number(o.BetMoney) || 0,
    money: Number(o.Money) || 0,
    status: String(o.Status || ""),
    createAt: Number(o.CreateAt) || 0,
    domain: o.Domain,
    sport: o.Sport,
    source: o.Source,
    game: o.Game,
    matchId: col.matchId,
    matchKey: col.key,
    matchLabel: col.label,
    matchStartTime: resolveMatchStartTime(col, safeStartIndex),
    pmTokenId: o.PmTokenId,
    pmShares: o.PmShares,
    pmFillPrice: o.PmFillPrice,
    pmStakeUsdc: o.PmStakeUsdc,
    pmFeeUsdc: o.PmFeeUsdc,
    pmConditionId: o.PmConditionId,
    pmOrigin: o.PmOrigin,
    pmAttributedSellShares: o.PmAttributedSellShares,
    pmRealizedPnlUsdc: o.PmRealizedPnlUsdc,
    pmSellProceeds: o.PmSellProceeds,
    pmLastSellOrderId: o.PmLastSellOrderId,
    pmSellState: o.PmSellState,
    pmSide: o.PmSide,
    pmBuyOrderId: o.PmBuyOrderId,
    pfSide: o.PfSide,
    pfBuyOrderId: o.PfBuyOrderId,
    pfSellState: o.PfSellState,
    pfShares: o.PfShares,
    pfHoldShares: o.PfHoldShares,
    pfNotionalUsdt: o.PfNotionalUsdt,
    pfFillCostUsdt: o.PfFillCostUsdt,
    pfBookPrice: o.PfBookPrice,
    pfTokenId: o.PfTokenId,
    pfMarketId: o.PfMarketId,
    pfSellOrderId: o.PfSellOrderId,
    pfSellProceeds: o.PfSellProceeds,
    pfFeeAmountWei: o.PfFeeAmountWei,
    pfFeeType: o.PfFeeType,
    pfFeeUsdt: o.PfFeeUsdt,
    pfFeeRateBps: o.PfFeeRateBps,
    pfChangmenCodeFeeRateBps: o.PfChangmenCodeFeeRateBps,
    pfChangmenCodeFeeShares: o.PfChangmenCodeFeeShares,
    pfChangmenCodeFeeUsdt: o.PfChangmenCodeFeeUsdt,
    positionEvents: o.PositionEvents,
  };
}

/** 历史订单：回填 player 展示字段（含已删账号） */
export async function attachPlayerDisplayToAdminOrders(list) {
  const ids = [...new Set(
    (list || []).map(r => Number(r.playerId) || 0).filter(id => id > 0),
  )];
  if (!ids.length)
    return list || [];
  const players = await sb.fetchPlayersByIdsIncludingDeleted(ids);
  const byId = new Map(players.map(p => [Number(p.id ?? p.playerId), p]));
  return (list || []).map((row) => {
    const p = byId.get(Number(row.playerId) || 0);
    if (!p)
      return row;
    const data
      = p.accountData && typeof p.accountData === "object" && !Array.isArray(p.accountData)
        ? p.accountData
        : {};
    const venueAccountName = String(data.venueAccountName || "").trim();
    return {
      ...row,
      playerName: String(p.playerName || "").trim() || undefined,
      platformName: String(p.platformName || "").trim() || undefined,
      venueAccountName: venueAccountName || undefined,
      playerDeleted: p.deletedAt != null,
    };
  });
}

export async function listAdminOrders(body = {}, caller = null) {
  const dateKey = body.date ? String(body.date) : toDateKey(Date.now());
  const pageIndex = Math.max(1, Number(body.pageIndex) || 1);
  // 与矩阵视图 fetchOrdersAdminAll 同量级；前端 getAdminOrdersAll 一次拉全日
  const pageSize = Math.min(5000, Math.max(1, Number(body.pageSize) || 50));
  const userId = body.userId ? String(body.userId) : "";
  const provider = body.provider ? String(body.provider) : "";
  const playerIdRaw = Number(body.playerId ?? body.player_id ?? 0);
  const playerId = Number.isFinite(playerIdRaw) && playerIdRaw > 0 ? playerIdRaw : undefined;

  let userIds;
  if (caller && !isAdminUser(caller)) {
    const allProfiles = await sb.fetchProfilesAdmin();
    const visibleIds = resolveVisibleUserIds(caller, allProfiles);
    if (visibleIds) {
      if (userId && !visibleIds.has(userId)) {
        return { date: dateKey, list: [], total: 0, pageIndex, pageSize, hasMore: false };
      }
      userIds = [...visibleIds];
    }
  }

  const filter = {
    dateKey,
    userId: userId || undefined,
    provider: provider || undefined,
    playerId,
    userIds,
  };
  const { rows, total } = await sb.fetchOrdersAdminPage({ ...filter, pageIndex, pageSize });
  const enriched = await enrichOrdersBelongingToDate(rows || [], dateKey, {
    userId: userId || undefined,
    userIds,
  });
  // enrich 会按 Link 并入套利对腿（如 PB）；请求了 provider 时仍只返回该场馆
  const scoped = provider
    ? enriched.filter(r => String(r?.provider || "").trim() === provider)
    : enriched;
  const list = await attachPlayerDisplayToAdminOrders(scoped.map(r => mapAdminOrderRow(r)));
  const sqlTotal = Number(total) || 0;
  // total/hasMore 按 SQL create_at 当日分页；list 经 enrich 后可含跨日 sibling / 整页被滤空
  return {
    date: dateKey,
    list,
    total: sqlTotal,
    pageIndex,
    pageSize,
    hasMore: pageIndex * pageSize < sqlTotal,
  };
}

/** Client_AdminDeleteOrders：form body 里 orderIds 常为 JSON.stringify 后的数组字符串 */
export function parseAdminOrderIdList(raw) {
  if (raw == null || raw === "")
    return [];
  if (Array.isArray(raw))
    return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed)
      return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed))
          return parsed;
      }
      catch {
        // fall through
      }
    }
    return [trimmed];
  }
  return [raw];
}

/** 管理端：按主键 id 删除订单（可批量，如同 Link 套利组） */
export async function deleteAdminOrders(body = {}, caller = null) {
  if (caller && !isAdminUser(caller))
    throw new Error("仅管理员可删除订单");
  const raw = body.orderIds ?? body.ids ?? body.id;
  const ids = parseAdminOrderIdList(raw);
  const deleted = await sb.deleteOrdersByIds(ids);
  if (!deleted)
    throw new Error("删除失败或订单不存在");
  return { deleted };
}

/** 管理端：当日全量订单（对阵矩阵视图） */
export async function listAdminOrdersMatrix(body = {}, caller = null) {
  const dateKey = body.date ? String(body.date) : toDateKey(Date.now());
  const provider = body.provider ? String(body.provider) : "";

  let userIds;
  if (caller && !isAdminUser(caller)) {
    const allProfiles = await sb.fetchProfilesAdmin();
    const visibleIds = resolveVisibleUserIds(caller, allProfiles);
    if (visibleIds)
      userIds = [...visibleIds];
  }

  const filter = {
    dateKey,
    provider: provider || undefined,
    userIds,
  };
  const [rows, clientMatches] = await Promise.all([
    sb.fetchOrdersAdminAll(filter),
    sb.fetchClientMatches(),
  ]);
  const enriched = await enrichOrdersBelongingToDate(rows || [], dateKey, { userIds });
  const startIndex = buildClientMatchStartIndex(clientMatches);
  const list = await attachPlayerDisplayToAdminOrders(
    enriched.map(r => mapAdminOrderRow(r, startIndex)),
  );
  return { date: dateKey, list, total: list.length };
}

/** 管理端：Link / order_id 关联 Client_SaveUserLog 诊断 */
export async function listAdminOrderLogs(body = {}, caller = null) {
  const userId = String(body.userId ?? body.user_id ?? "").trim();
  const linkRaw = body.linkId ?? body.link ?? body.LinkID;
  const orderId = body.orderId ?? body.order_id ?? body.OrderID;
  if (!userId)
    throw new Error("缺少 userId");
  if (caller && !isAdminUser(caller)) {
    const visibleIds = await getVisibleUserIds(caller);
    if (visibleIds && !visibleIds.has(userId))
      throw new Error("无权查看该用户的日志");
  }
  if (linkRaw == null && !orderId && !body.executionId && !body.attemptId && !body.eventId)
    throw new Error("请指定 linkId、orderId 或执行编号");

  const result = await lookupOrderLogs({
    userId,
    link: linkRaw ?? undefined,
    executionId: body.executionId,
    attemptId: body.attemptId,
    eventId: body.eventId,
    preferDirect: body.preferDirect === true,
    orderId: orderId ? String(orderId) : undefined,
    domain: body.domain,
    sport: body.sport,
    venue: body.venue,
    paddingMs: body.paddingMs,
    logLimit: body.logLimit,
  });
  const payload = toAdminOrderLogPayload(result);
  if (!payload.ok)
    throw new Error(payload.error || "查询失败");
  return payload;
}

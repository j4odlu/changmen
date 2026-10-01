/**
 * 足球订单读写。管理端仅查询 football_orders 中的 OB 足球订单。
 */
import * as sb from "@changmen/db";
import { randomUUID } from "node:crypto";
import { assertPlayerOwnedByUser } from "../account/player_ownership.js";
import {
  parseFootballOrderInput,
  parseFootballOrderStatusPatch,
  publicFootballOrder,
} from "./football_order.js";

function fail(msg) {
  return { ok: false, msg };
}

function ok(info) {
  return { ok: true, info };
}

function podExecutionInput(body) {
  const alertId = String(body?.alertId || "").trim().slice(0, 240);
  const venueRaw = String(body?.venue || "").trim().toLowerCase();
  const venue = venueRaw === "ob" ? "OB" : venueRaw === "polymarket" ? "Polymarket" : "";
  const playerId = Math.round(Number(body?.playerId) || 0);
  if (!alertId || !venue || playerId <= 0)
    return null;
  return { alertId, venue, playerId };
}

export async function reservePodBet(body, user) {
  const userId = String(user?.id || "").trim();
  const input = podExecutionInput(body);
  if (!userId)
    return fail("未登录");
  if (!input)
    return fail("POD执行参数无效");
  try {
    const owned = await assertPlayerOwnedByUser(input.playerId, userId);
    if (!owned.ok)
      return fail(owned.msg);
    const provider = String(owned.player?.provider || owned.player?.platformName || "").trim().toLowerCase();
    if (provider !== input.venue.toLowerCase())
      return fail(`playerId ${input.playerId} 不是 ${input.venue} 账号`);
  }
  catch (err) {
    return fail(err instanceof Error ? err.message : "校验下注账号失败");
  }
  const now = Date.now();
  const leaseToken = randomUUID();
  try {
    const result = await sb.reservePodBetExecution({
      userId,
      ...input,
      leaseToken,
      now,
    });
    return ok({
      acquired: result.acquired === true,
      leaseToken: result.acquired ? leaseToken : "",
      state: String(result.row?.state || ""),
      venueOrderId: String(result.row?.venue_order_id || ""),
    });
  }
  catch (err) {
    return fail(err instanceof Error ? err.message : "申请下注执行权失败");
  }
}

export async function finalizePodBet(body, user) {
  const userId = String(user?.id || "").trim();
  const leaseToken = String(body?.leaseToken || "").trim();
  const rawState = String(body?.state || "").trim().toLowerCase();
  const state = rawState === "accepted"
    ? "accepted"
    : rawState === "failed"
      ? "failed"
      : rawState === "unknown" ? "unknown" : "";
  if (!userId)
    return fail("未登录");
  if (!leaseToken || !state)
    return fail("POD执行结果无效");
  try {
    const saved = await sb.finalizePodBetExecution({
      userId,
      leaseToken,
      state,
      venueOrderId: String(body?.venueOrderId || "").trim().slice(0, 240),
      message: String(body?.message || "").trim().slice(0, 500),
      now: Date.now(),
    });
    return saved ? ok({ state: saved.state }) : fail("POD执行权不存在或已完成");
  }
  catch (err) {
    return fail(err instanceof Error ? err.message : "保存下注执行结果失败");
  }
}

function parseIdList(raw) {
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
      catch { /* fall through */ }
    }
    return [trimmed];
  }
  return [raw];
}

function sumStake(list) {
  let n = 0;
  for (const row of list)
    n += Number(row.stake) || 0;
  return n;
}

function sumProfit(list) {
  let n = 0;
  for (const row of list) {
    const status = String(row.status || "None");
    if (status === "None" || status === "Pending")
      continue;
    n += Number(row.profit) || 0;
  }
  return n;
}

function isObFootballOrder(row) {
  return String(row?.venue || "OB").trim().toUpperCase() === "OB";
}

/**
 * @param {unknown} body
 * @param {{ id: string }} user
 */
export async function saveFootballOrder(body, user) {
  const userId = String(user?.id || "").trim();
  if (!userId)
    return fail("未登录");
  const raw = body?.order ?? body;
  const parsed = parseFootballOrderInput(raw);
  if (parsed) {
    const now = Date.now();
    try {
      const saved = await sb.upsertFootballOrder({
        userId,
        playerId: parsed.playerId,
        venue: parsed.venue,
        venueOrderId: parsed.venueOrderId,
        clientId: parsed.clientId,
        home: parsed.home,
        away: parsed.away,
        sideLabel: parsed.sideLabel,
        marketLabel: parsed.marketLabel,
        odds: parsed.odds,
        stake: parsed.stake,
        oid: parsed.oid,
        obMid: parsed.obMid,
        auto: parsed.auto,
        accountName: parsed.accountName,
        status: parsed.status,
        profit: parsed.profit,
        placedAt: parsed.placedAt,
        createdAt: now,
      });
      const pub = publicFootballOrder(saved);
      if (!pub)
        return fail("写入失败");
      return ok(pub);
    }
    catch (err) {
      return fail(err instanceof Error ? err.message : "保存失败");
    }
  }
  const patch = parseFootballOrderStatusPatch(raw);
  if (!patch)
    return fail("缺少订单");
  try {
    const saved = await sb.patchFootballOrderStatus({
      userId,
      venue: patch.venue,
      venueOrderId: patch.venueOrderId,
      status: patch.status,
      profit: patch.profit,
    });
    const pub = publicFootballOrder(saved);
    if (!pub)
      return fail("未找到场馆单号");
    return ok(pub);
  }
  catch (err) {
    return fail(err instanceof Error ? err.message : "结算回写失败");
  }
}

/**
 * @param {{ id: string }} user
 */
export async function listFootballOrders(user, body = {}) {
  const userId = String(user?.id || "").trim();
  if (!userId)
    return fail("未登录");
  const now = new Date();
  const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const date = String(body.date || "").trim() || fallback;
  try {
    // 与电竞 Client_GetOrderList 的按日 pageSize=1024 保持一致。
    const rows = await sb.fetchFootballOrdersByUser(userId, { date, limit: 1024 });
    return ok({ date, list: rows.map(publicFootballOrder).filter(Boolean).filter(isObFootballOrder) });
  }
  catch (err) {
    return fail(err instanceof Error ? err.message : "查询失败");
  }
}

/**
 * @param {{ id: string }} user
 */
export async function listOpenFootballOrders(user, body = {}) {
  const userId = String(user?.id || "").trim();
  if (!userId)
    return fail("未登录");
  const days = Math.min(Math.max(Number(body.days) || 7, 1), 30);
  const sinceMs = Date.now() - days * 24 * 3600_000;
  try {
    const rows = await sb.fetchOpenFootballOrdersByUser(userId, {
      sinceMs,
      limit: 500,
    });
    return ok({ list: rows.map(publicFootballOrder).filter(Boolean).filter(isObFootballOrder) });
  }
  catch (err) {
    return fail(err instanceof Error ? err.message : "查询失败");
  }
}

/**
 * @param {Record<string, unknown>} body
 */
export async function listAdminFootballOrders(body = {}) {
  const now = new Date();
  const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const date = String(body.date || "").trim() || fallback;
  const userId = String(body.userId || "").trim();
  const footballRows = await sb.fetchFootballOrdersAdmin({
    date,
    userId,
    limit: 2000,
  });
  const list = footballRows.map(publicFootballOrder).filter(Boolean).filter(isObFootballOrder)
    .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
  return {
    date,
    list,
    total: list.length,
    todayStake: sumStake(list),
    todayProfit: sumProfit(list),
  };
}

export async function deleteAdminFootballOrders(body = {}) {
  const ids = parseIdList(body.orderIds ?? body.ids ?? body.id);
  const deleted = await sb.deleteFootballOrdersByIds(ids);
  if (!deleted)
    throw new Error("删除失败或足球订单不存在");
  return { deleted };
}

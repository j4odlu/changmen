import {
  fetchBettingUserLogsInRange, fetchFootballOrderByVenueOrderId, fetchOrderByOrderId,
  fetchOrderObservations, fetchOrdersByLink, fetchOrdersByLinks, fetchUserById, fetchUserByName,
} from "@changmen/db";
import { summarizeOrderObservations } from "../order_observation.js";
import { computeLogWindow, filterRelevantLogs, groupMetaLabel, linkTypeLabel } from "./rules.js";
import { summarizeUserLog } from "./logs.js";
import { normalizeOrderRow, footballOrderToLogOrderRow, diagnosticOrderRecords, directObservationResult } from "./payload.js";

async function resolveLookupUser(opts) {
  const userId = String(opts?.userId || "").trim();
  if (userId)
    return fetchUserById(userId);
  const userName = String(opts?.userName || "").trim();
  if (userName)
    return fetchUserByName(userName);
  return null;
}

async function lookupObservationOnly(user, anchor, link = 0, selector = {}, preferDirect = false) {
  const query = await fetchOrderObservations(user.id, link, 2000, [], selector);
  const observation = summarizeOrderObservations(query);
  if (!observation.events?.length)
    return { ok: false, error: observation.status === "unavailable" ? "执行观察记录暂不可用" : "未找到订单或执行记录（可能尚未上传）" };
  // [changmen 扩展] 按事件的明确身份批量读取当前订单，不通过时间或平台相同猜测关联。
  const refs = observation.events.filter(event => event.provider && event.orderId && event.accountId !== undefined);
  const links = [...new Set(refs.map(event => event.linkId).filter(value => Number.isSafeInteger(value) && value !== 0))];
  const candidates = preferDirect && links.length ? await fetchOrdersByLinks(user.id, links) : [];
  const orders = candidates.filter(order => refs.some(event => String(order.order_id) === event.orderId
    && order.provider === event.provider && Number(order.player_id) === event.accountId && Number(order.link) === event.linkId));
  const resolvedLink = link || (new Set(observation.events.map(event => event.linkId)).size === 1 ? observation.events[0].linkId : 0);
  return directObservationResult(user, anchor, resolvedLink, query, orders, Boolean(link) || (preferDirect && links.length > 0));
}

export async function lookupOrderLogs(opts) {
  const user = await resolveLookupUser(opts);
  if (!user?.id) {
    const hint = opts?.userId
      ? `用户不存在: ${opts.userId}`
      : opts?.userName
        ? `用户不存在: ${opts.userName}`
        : "缺少 userName 或 userId";
    return { ok: false, error: hint };
  }

  if (opts?.executionId || opts?.attemptId || opts?.eventId) {
    const key = opts.eventId ? "eventId" : opts.executionId ? "executionId" : "attemptId";
    const value = String(opts[key]);
    if (!/^[\w-]{8,160}$/.test(value))
      return { ok: false, error: "无效执行编号" };
    return lookupObservationOnly(user, { type: key, value }, 0, { [key]: value }, opts.preferDirect === true);
  }
  let orders = [];
  let anchor = { type: "user", value: user.user_name };

  if (opts?.link != null && String(opts.link).trim() !== "") {
    const linkVal = Number(opts.link);
    if (!Number.isSafeInteger(linkVal) || linkVal === 0) {
      return { ok: false, error: "无效 link" };
    }
    orders = await fetchOrdersByLink(user.id, linkVal);
    anchor = { type: "link", value: linkVal };
    if (!orders.length) {
      return lookupObservationOnly(user, anchor, linkVal, {}, opts.preferDirect === true);
    }
  }
  else if (opts?.orderId) {
    let row = await fetchOrderByOrderId(user.id, opts.orderId);
    if (!row && String(opts?.domain || "").toLowerCase() === "sports" && String(opts?.sport || "").toLowerCase() === "football") {
      const football = await fetchFootballOrderByVenueOrderId(
        user.id,
        opts.orderId,
        opts.venue || "OB",
      );
      row = footballOrderToLogOrderRow(football);
    }
    if (!row) {
      return {
        ok: false,
        error: `未找到 order_id=${opts.orderId}`,
        user: { id: user.id, userName: user.user_name },
      };
    }
    orders = [row];
    if (row.link) {
      const linked = await fetchOrdersByLink(user.id, row.link);
      if (linked.length)
        orders = linked;
    }
    anchor = { type: "orderId", value: String(opts.orderId) };
  }
  else {
    return { ok: false, error: "请指定 link 或 orderId" };
  }

  const normalized = orders.map(normalizeOrderRow).filter(Boolean);
  const link = normalized[0]?.link ?? 0;
  const observationQuery = await fetchOrderObservations(user.id, link, 2000, normalized.map(order => ({
    provider: order.provider, accountId: String(order.playerId), orderId: order.orderId,
  })));
  if (opts.preferDirect === true && observationQuery.status === "available" && observationQuery.events.some(event => event.kind !== "transport_gap"))
    return directObservationResult(user, anchor, link, observationQuery, orders, true);
  const window = computeLogWindow(orders, opts?.paddingMs);
  if (!window) {
    return { ok: false, error: "无法计算日志时间窗" };
  }

  const diagnosticQuery = await fetchBettingUserLogsInRange(
    user.id,
    window.fromMs,
    window.toMs,
    opts?.logLimit ?? 1000,
    { link, orderIds: normalized.map(order => order.orderId) },
  );
  const logs = diagnosticQuery.rows;
  const summarizedLogs = logs.map(summarizeUserLog);
  const { relevant, unrelated } = filterRelevantLogs(normalized, summarizedLogs);
  // [changmen 扩展] 当前订单只读白名单，原始 raw 不进入判定依据。
  const observation = summarizeOrderObservations(observationQuery, diagnosticOrderRecords(orders));
  return {
    ok: true,
    user: { id: user.id, userName: user.user_name },
    anchor,
    link,
    linkType: linkTypeLabel(link),
    observation,
    diagnosticSource: "legacy",
    legacyLogsLoaded: true,
    ordersQueried: true,
    groupLabel: groupMetaLabel(link, normalized.length),
    logWindow: window,
    orders: normalized,
    logs: relevant,
    unrelatedLogs: unrelated,
    logStats: {
      total: summarizedLogs.length,
      related: relevant.length,
      unrelated: unrelated.length,
      truncated: diagnosticQuery.truncated,
      limit: diagnosticQuery.limit,
    },
    logsRaw: logs,
  };
}

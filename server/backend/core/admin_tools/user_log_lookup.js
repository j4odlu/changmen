/**
 * [changmen 扩展] 运维：订单 Link / order_id ↔ user_logs 关联（不改前端 A8 链路）
 */
import {
  fetchBettingUserLogsInRange,
  fetchFootballOrderByVenueOrderId,
  fetchOrderByOrderId,
  fetchOrderObservations,
  fetchOrdersByLink,
  fetchUserById,
  fetchUserByName,
} from "@changmen/db";
import { summarizeOrderObservations } from "./order_observation.js";

export const ARB_LINK_MIN = 1_000_000_000_000;
export const DEFAULT_LOG_PADDING_MS = 180_000;
const RELATED_BET_LOG_WINDOW_MS = 15_000;

export function linkTypeLabel(link) {
  const n = Number(link);
  if (!Number.isFinite(n) || n === 0)
    return "未知";
  if (n < 0)
    return "单边";
  if (n >= ARB_LINK_MIN)
    return "套利";
  return "hash";
}

export function groupMetaLabel(link, orderCount) {
  const n = Number(link);
  if (Number.isFinite(n) && n < 0)
    return "单边";
  if (orderCount > 1 && Number.isFinite(n) && n >= ARB_LINK_MIN) {
    return `套利 ${orderCount} 笔`;
  }
  if (Number.isFinite(n) && n >= ARB_LINK_MIN)
    return "单笔";
  return "hash/未绑定";
}

/** 以订单 create_at 与 link 时间戳估窗口 */
export function computeLogWindow(orders, paddingMs = DEFAULT_LOG_PADDING_MS) {
  const pad = Math.min(Math.max(Number(paddingMs) || DEFAULT_LOG_PADDING_MS, 30_000), 86_400_000);
  const times = (orders || [])
    .map(o => Number(o.create_at) || 0)
    .filter(t => t > 0);
  for (const o of orders || []) {
    const linkTs = Number(o.link) || 0;
    const absLinkTs = Math.abs(linkTs);
    if (absLinkTs >= ARB_LINK_MIN)
      times.push(absLinkTs);
  }
  if (!times.length)
    return null;
  const min = Math.min(...times);
  const max = Math.max(...times);
  return { fromMs: min - pad, toMs: max + pad };
}

export function parseLogData(raw) {
  if (raw == null || raw === "")
    return null;
  if (typeof raw === "object")
    return raw;
  try {
    return JSON.parse(String(raw));
  }
  catch {
    return { raw: String(raw) };
  }
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function textMatches(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right)
    return false;
  return left.includes(right) || right.includes(left);
}

function orderLogMatchScore(order, log) {
  let score = 0;
  const reasons = [];
  if (log.linkId && Number(log.linkId) === Number(order.link)) {
    score += 120;
    reasons.push("link_id");
  }
  if (log.orderId && String(log.orderId) === String(order.orderId)) {
    score += 100;
    reasons.push("order_id");
  }
  if (log.provider && order.provider && String(log.provider) === String(order.provider)) {
    score += 12;
    reasons.push("平台");
  }
  if (log.match && order.match && textMatches(log.match, order.match)) {
    score += 60;
    reasons.push("比赛");
  }
  if (log.bet && order.bet && textMatches(log.bet, order.bet)) {
    score += 18;
    reasons.push("盘口");
  }
  if (log.item && order.item && textMatches(log.item, order.item)) {
    score += 8;
    reasons.push("选项");
  }
  if (Number(log.odds) && Number(order.odds)) {
    const diff = Math.abs(Number(log.odds) - Number(order.odds));
    if (diff <= 0.001) {
      score += 12;
      reasons.push("赔率");
    }
    else if (diff <= 0.08) {
      score += 5;
      reasons.push("近似赔率");
    }
  }
  if (Number(log.betMoney) && Number(order.betMoney)) {
    const diff = Math.abs(Number(log.betMoney) - Number(order.betMoney));
    if (diff <= 1) {
      score += 8;
      reasons.push("金额");
    }
  }
  const delta = Math.abs(Number(log.createAt) - Number(order.createAt));
  if (delta <= RELATED_BET_LOG_WINDOW_MS) {
    score += 8;
    reasons.push("时间");
  }
  else if (delta <= DEFAULT_LOG_PADDING_MS) {
    score += 2;
  }
  return { score, reasons };
}

function findBestOrderMatch(orders, log) {
  let best = null;
  for (const order of orders || []) {
    const match = orderLogMatchScore(order, log);
    if (!best || match.score > best.score) {
      best = { order, ...match };
    }
  }
  return best;
}

function isStrongLogOrderMatch(best, log) {
  if (!best)
    return false;
  // 新日志已经携带 LinkID：它是一次编排的唯一标识。只要日志明确声明了
  // LinkID，就必须精确命中，不能再退回比赛名/时间等旧日志启发式规则。
  if (log.linkId)
    return best.reasons.includes("link_id");
  if (log.orderId && best.reasons.includes("order_id"))
    return true;
  if (log.kind === "check") {
    // 旧日志没有 linkId；同一比赛可能在几分钟内连续触发多轮套利，
    // 只凭比赛名会把其他 Link 的赔率/金额误当成当前“计划腿”。
    return (best.reasons.includes("比赛") && best.reasons.includes("时间"))
      // 同一场馆的队名别名可能完全不同；同盘口且紧邻订单时仍属于本轮套利。
      || (best.reasons.includes("盘口") && best.reasons.includes("时间"));
  }
  if (log.kind === "reject") {
    return best.reasons.includes("order_id")
      || (best.reasons.includes("平台") && best.reasons.includes("时间"))
      || (best.reasons.includes("平台") && best.reasons.includes("比赛"));
  }
  return best.score >= 80;
}

function sameLogActor(a, b) {
  if (!a || !b)
    return false;
  if (a.accountLabel && b.accountLabel && a.accountLabel === b.accountLabel)
    return true;
  return Boolean(a.provider && b.provider && a.provider === b.provider);
}

export function filterRelevantLogs(orders, logs) {
  const relevant = [];
  const unrelated = [];
  const lastRelevantCheckByActor = new Map();

  const actorKey = log => String(log?.accountLabel || log?.provider || "").trim();
  const providerMatchesOrder = (log, order) => !log?.provider
    || !order?.provider
    || String(log.provider) === String(order.provider);

  for (const log of logs || []) {
    const best = findBestOrderMatch(orders, log);
    let keep = isStrongLogOrderMatch(best, log);
    const reasons = keep ? [...best.reasons] : [];
    const previousCheck = lastRelevantCheckByActor.get(actorKey(log));
    if (!keep && !log.linkId && log.kind === "bet" && previousCheck && sameLogActor(log, previousCheck)) {
      const delta = Number(log.createAt) - Number(previousCheck.createAt);
      if (delta >= 0 && delta <= RELATED_BET_LOG_WINDOW_MS) {
        keep = true;
        reasons.push("同预检下注链路");
      }
    }
    if (!keep && log.kind === "other") {
      unrelated.push({ ...log, related: false, relationReason: "非下注诊断日志" });
      continue;
    }
    // 补单入队描述的是“准备补哪一腿”，不是已存在的任一场馆订单。
    // 即使 Link 精确命中，也必须作为独立步骤按 target 展示。
    const isQueueEvent = log.kind === "makeup_queue" || log.kind === "makeup_cancel";
    const inferredOrderId = !isQueueEvent && keep && best?.order && providerMatchesOrder(log, best.order)
      ? best.order.orderId
      : !isQueueEvent ? previousCheck?.matchedOrderId ?? null : null;
    const next = {
      ...log,
      related: keep,
      relationScore: best?.score ?? 0,
      relationReason: reasons.join("、") || (keep ? "相关" : "未匹配订单"),
      // provider 不同只能证明是同场尝试，不能硬挂到另一场馆的订单上。
      matchedOrderId: inferredOrderId,
    };
    if (keep) {
      relevant.push(next);
      if (log.kind === "check") {
        const key = actorKey(next);
        if (key)
          lastRelevantCheckByActor.set(key, next);
      }
    }
    else {
      unrelated.push(next);
    }
  }

  return { relevant, unrelated };
}

export function classifyLogTitle(title) {
  const t = String(title || "");
  if (t.includes("请求盘口数据"))
    return "check";
  if (t.includes("下注 =>"))
    return "bet";
  if (t.includes("拒单"))
    return "reject";
  if (t.includes("补单入队"))
    return "makeup_queue";
  if (t.includes("补单取消"))
    return "makeup_cancel";
  return "other";
}

/** 从 title / data 推断平台（如 [RAY](...)） */
export function extractLogProvider(title, parsed, kind) {
  const bracket = String(title || "").match(/^\[([^\]]+)\]/);
  if (bracket?.[1])
    return bracket[1];
  if (kind === "check" && parsed?.options?.type)
    return String(parsed.options.type);
  if (kind === "bet" && parsed?.result?.provider)
    return String(parsed.result.provider);
  if (parsed?.provider)
    return String(parsed.provider);
  return null;
}

/** 按平台分栏：先订单平台，再仅出现在日志里的平台，最后「其他」 */
export function buildPlatformSections(orders, logs) {
  const sections = [];
  const byKey = new Map();

  const keyOf = provider => (provider ? String(provider) : "__other__");
  const labelOf = provider => provider || "其他";

  const touch = (provider) => {
    const key = keyOf(provider);
    if (!byKey.has(key)) {
      const section = {
        provider: provider || null,
        label: labelOf(provider),
        orders: [],
        logs: [],
      };
      byKey.set(key, section);
      sections.push(section);
    }
    return byKey.get(key);
  };

  for (const order of orders || []) {
    touch(order.provider).orders.push(order);
  }
  for (const log of logs || []) {
    touch(log.provider).logs.push(log);
  }

  for (const section of sections) {
    section.logs.sort((a, b) => a.createAt - b.createAt);
  }

  return sections;
}

/** 从日志推断关联 order_id（下注结果 / PB 拒单轮询） */
export function extractLogOrderId(title, parsed, kind) {
  if (kind === "bet" && parsed?.result?.orderId) {
    return String(parsed.result.orderId);
  }
  if (kind === "reject") {
    if (parsed?.orderId)
      return String(parsed.orderId);
    const m = String(title || "").match(/-\s*(\S+)\s+拒单/);
    if (m?.[1])
      return m[1];
  }
  return null;
}

/**
 * 按订单分栏：每笔订单一列；同平台未成单尝试单独成列（provider · 未成单）
 */
export function buildOrderSections(orders, logs) {
  const sortedOrders = [...(orders || [])].sort((a, b) => a.createAt - b.createAt);
  const sections = [];
  const byOrderId = new Map();
  const ordersByProvider = new Map();

  for (const order of sortedOrders) {
    const section = {
      key: order.orderId,
      label: String(order.provider || "未知"),
      order,
      logs: [],
    };
    sections.push(section);
    byOrderId.set(order.orderId, section);
    const prov = order.provider;
    if (!ordersByProvider.has(prov))
      ordersByProvider.set(prov, []);
    ordersByProvider.get(prov).push(order);
  }

  const orphanByProvider = new Map();
  const touchOrphan = (provider) => {
    const key = provider ? String(provider) : "__other__";
    if (!orphanByProvider.has(key)) {
      const section = {
        key: `orphan:${key}`,
        label: provider ? `${provider} · 未成单` : "其他",
        order: null,
        logs: [],
      };
      orphanByProvider.set(key, section);
      sections.push(section);
    }
    return orphanByProvider.get(key);
  };

  for (const log of logs || []) {
    const orderId = log.orderId || log.matchedOrderId ? String(log.orderId || log.matchedOrderId) : null;
    if (orderId && byOrderId.has(orderId)) {
      byOrderId.get(orderId).logs.push(log);
      continue;
    }

    const provider = log.provider;
    const pool = provider ? ordersByProvider.get(provider) : null;

    if (!pool?.length) {
      touchOrphan(provider).logs.push(log);
      continue;
    }
    if (pool.length === 1) {
      byOrderId.get(pool[0].orderId).logs.push(log);
      continue;
    }

    let best = pool[0];
    let bestDist = Math.abs(log.createAt - best.createAt);
    for (const o of pool.slice(1)) {
      const dist = Math.abs(log.createAt - o.createAt);
      if (dist < bestDist) {
        bestDist = dist;
        best = o;
      }
    }
    byOrderId.get(best.orderId).logs.push(log);
  }

  for (const section of sections) {
    section.logs.sort((a, b) => a.createAt - b.createAt);
  }

  return sections
    .filter(s => s.order || s.logs.length > 0)
    .sort((a, b) => {
      if (a.order && b.order)
        return a.order.createAt - b.order.createAt;
      if (a.order)
        return -1;
      if (b.order)
        return 1;
      return (a.logs[0]?.createAt || 0) - (b.logs[0]?.createAt || 0);
    });
}

/** 从预检日志 / 摘要解析 Home|Away */
export function extractLogTarget(parsed, kind, summary) {
  if (kind === "check" && parsed?.options?.target) {
    const t = String(parsed.options.target);
    if (t === "Home" || t === "Away")
      return t;
  }
  const m = String(summary || "").match(/\s(Home|Away)@/);
  return m?.[1] || null;
}

function parseObRequestLine(request) {
  if (!request || typeof request !== "object")
    return {};
  const line = Object.keys(request)
    .filter(k => /^b\[\d+\]$/.test(k))
    .map(k => request[k])
    .find(Boolean);
  if (!line)
    return {};
  const params = new URLSearchParams(String(line));
  const odds = Number(params.get("odd")) || undefined;
  const betMoney = Number(params.get("a")) || undefined;
  const itemId = params.get("oid") || undefined;
  return { odds, betMoney, itemId };
}

export function sideDisplayLabel(side) {
  if (side === "Home")
    return "主队";
  if (side === "Away")
    return "客队";
  return "未知";
}

function formatLegLabel(side) {
  return sideDisplayLabel(side);
}

function inferTargetFromLogs(logs, provider = null) {
  const list = logs || [];
  const preferred = provider
    ? list.filter(log => !log.provider || String(log.provider) === String(provider))
    : list;
  for (const log of preferred) {
    if (log.target === "Home" || log.target === "Away")
      return log.target;
  }
  for (const log of preferred) {
    const m = String(log.summary || "").match(/\s(Home|Away)@/);
    if (m)
      return m[1];
  }
  if (preferred !== list)
    return inferTargetFromLogs(list);
  return null;
}

function createSideLegs() {
  return [
    { key: "leg-home", legIndex: 0, side: "Home", label: "主队", provider: null, attempts: [] },
    { key: "leg-away", legIndex: 1, side: "Away", label: "客队", provider: null, attempts: [] },
  ];
}

function legIndexForSide(side) {
  return side === "Away" ? 1 : 0;
}

function touchLegProvider(leg, provider) {
  if (!provider)
    return;
  if (!leg.provider) {
    leg.provider = provider;
    return;
  }
  if (leg.provider.includes(provider))
    return;
  leg.provider = `${leg.provider}/${provider}`;
}

function refreshLegLabels(legs) {
  for (const leg of legs) {
    leg.label = formatLegLabel(leg.side);
  }
}

function resolveLegIndexByProvider(provider, legs) {
  if (!provider)
    return legs[0].attempts.length <= legs[1].attempts.length ? 0 : 1;
  for (let i = 0; i < 2; i++) {
    if (legs[i].provider === provider || legs[i].provider?.includes(provider))
      return i;
    for (const att of legs[i].attempts) {
      if (att.order?.provider === provider)
        return i;
    }
  }
  return legs[0].attempts.length <= legs[1].attempts.length ? 0 : 1;
}

function pickLegIndexForUnassigned(legs) {
  const homeN = legs[0].attempts.length;
  const awayN = legs[1].attempts.length;
  if (homeN && !awayN)
    return 1;
  if (!homeN && awayN)
    return 0;
  return homeN <= awayN ? 0 : 1;
}

/** 从 Client_SaveUserLog title 解析账号展示，如 [OB](星空,4) → OB · 星空 / 4 */
export function extractLogAccountLabel(title) {
  const m = String(title || "").match(/^\[([^\]]+)\]\(([^,]+),([^)]+)\)/);
  if (!m)
    return null;
  const provider = m[1];
  const platformName = String(m[2]).trim();
  const playerName = String(m[3]).trim();
  return {
    provider,
    platformName,
    playerName,
    label: `${provider} · ${platformName} / ${playerName}`,
  };
}

/**
 * 按预检日志切分轮次（对齐 A8 主循环：每轮 1 次 check + 下注尝试）
 */
export function buildLogSegments(logs) {
  const sorted = [...(logs || [])].sort((a, b) => a.createAt - b.createAt);
  if (!sorted.length)
    return [];

  const segments = [];
  let current = null;

  const flush = () => {
    if (current?.logs?.length) {
      segments.push(current);
      current = null;
    }
  };

  for (const log of sorted) {
    // 入队是独立的编排事件，不能并入前一条“预检 → 下单”尝试；否则前一腿
    // 的真实失败会被前端误标为“仅入队”，诊断汇总也会漏算下单失败。
    if (log.kind === "makeup_queue" || log.kind === "makeup_cancel") {
      flush();
      current = {
        key: `seg-${log.id ?? log.createAt}`,
        accountLabel: null,
        provider: null,
        isMakeUp: false,
        logs: [log],
      };
      flush();
    }
    else if (log.kind === "check") {
      flush();
      const parsed = extractLogAccountLabel(log.title);
      current = {
        key: `seg-${log.id ?? log.createAt}`,
        accountLabel: log.accountLabel || parsed?.label || null,
        provider: log.provider || parsed?.provider || null,
        isMakeUp: Boolean(log.loseOrder),
        logs: [log],
      };
    }
    else if (current) {
      current.logs.push(log);
    }
    else {
      flush();
      const parsed = extractLogAccountLabel(log.title);
      current = {
        key: `seg-${log.id ?? log.createAt}`,
        accountLabel: log.accountLabel || parsed?.label || null,
        provider: log.provider || parsed?.provider || null,
        isMakeUp: Boolean(log.loseOrder),
        logs: [log],
      };
    }
  }
  flush();
  return segments;
}

/**
 * 主客队分栏：按 Home/Away；同侧拒单重下在同一栏内分段
 */
export function buildLegSections(orders, logs, meta = {}) {
  const sortedOrders = [...(orders || [])].sort((a, b) => a.createAt - b.createAt);
  const sortedLogs = [...(logs || [])].sort((a, b) => a.createAt - b.createAt);
  const groupLabel = String(meta.groupLabel || "");
  const linkType = String(meta.linkType || "");
  const isArb
    = linkType === "套利"
      || groupLabel.includes("套利")
      || (sortedOrders.length > 1 && sortedOrders.every(o => Number(o.link) >= ARB_LINK_MIN));

  const legs = createSideLegs();
  const attempts = sortedOrders.map(order => ({
    key: order.orderId,
    order,
    logs: [],
    logSegments: [],
    side: null,
  }));
  const attemptByOrderId = new Map(attempts.map(a => [a.order.orderId, a]));
  const orphanLogs = [];

  for (const log of sortedLogs) {
    const orderId = log.orderId || log.matchedOrderId ? String(log.orderId || log.matchedOrderId) : null;
    const attempt = orderId ? attemptByOrderId.get(orderId) : null;
    const isExactOrderId = Boolean(log.orderId && attempt);
    const providerCompatible = !log.provider
      || !attempt?.order?.provider
      || String(log.provider) === String(attempt.order.provider);
    if (attempt && (isExactOrderId || providerCompatible)) {
      attempt.logs.push(log);
    }
    else {
      orphanLogs.push(log);
    }
  }

  for (const att of attempts) {
    att.side = inferTargetFromLogs(att.logs, att.order?.provider);
    att.logs.sort((a, b) => a.createAt - b.createAt);
  }

  const unassigned = [];
  for (const att of attempts) {
    if (att.side === "Home" || att.side === "Away") {
      const leg = legs[legIndexForSide(att.side)];
      leg.attempts.push(att);
      touchLegProvider(leg, att.order.provider);
    }
    else {
      unassigned.push(att);
    }
  }

  for (const att of unassigned) {
    const legIdx = pickLegIndexForUnassigned(legs);
    att.side = legs[legIdx].side;
    legs[legIdx].attempts.push(att);
    touchLegProvider(legs[legIdx], att.order.provider);
  }

  for (const leg of legs) {
    leg.attempts.sort((a, b) => (a.order?.createAt ?? 0) - (b.order?.createAt ?? 0));
  }

  // 未落库尝试先按「预检 → 下注」切段。只有同平台、同方向时才并回真实订单，
  // 避免 PM 失败尝试因时间接近被塞进 RAY 订单，进而把整笔订单放错主客队。
  for (const segment of buildLogSegments(orphanLogs)) {
    const segmentLogs = segment.logs || [];
    const provider = segment.provider || segmentLogs.find(l => l.provider)?.provider || null;
    const side = inferTargetFromLogs(segmentLogs, provider);
    const firstAt = Number(segmentLogs[0]?.createAt) || 0;
    const compatible = attempts
      .filter(att => att.order
        && provider
        && String(att.order.provider) === String(provider)
        && side
        && att.side === side)
      .sort((a, b) => {
        const da = Math.abs(firstAt - (a.order?.createAt || firstAt));
        const db = Math.abs(firstAt - (b.order?.createAt || firstAt));
        return da - db;
      });
    const nearest = compatible[0];
    const nearestDelta = nearest?.order
      ? Math.abs(firstAt - Number(nearest.order.createAt))
      : Number.POSITIVE_INFINITY;

    if (nearest && nearestDelta <= DEFAULT_LOG_PADDING_MS) {
      nearest.logs.push(...segmentLogs);
      nearest.logs.sort((a, b) => a.createAt - b.createAt);
      continue;
    }

    const idx = side === "Home"
      ? 0
      : side === "Away"
        ? 1
        : resolveLegIndexByProvider(provider, legs);
    const orphanAttempt = {
      key: `orphan:${provider || "other"}:${segment.key}`,
      order: null,
      logs: [...segmentLogs],
      logSegments: [segment],
      side: legs[idx].side,
    };
    legs[idx].attempts.push(orphanAttempt);
    touchLegProvider(legs[idx], provider);
  }

  for (const leg of legs) {
    leg.attempts.sort((a, b) => {
      const at = a.order?.createAt ?? a.logs[0]?.createAt ?? 0;
      const bt = b.order?.createAt ?? b.logs[0]?.createAt ?? 0;
      return at - bt;
    });
    for (const att of leg.attempts) {
      if (!att.logSegments?.length)
        att.logSegments = buildLogSegments(att.logs);
    }
  }

  refreshLegLabels(legs);

  if (isArb) {
    return legs;
  }
  return legs.filter(leg => leg.attempts.some(a => a.order || a.logs.length > 0));
}

/** 从 saveUserLog 行提取可读摘要 */
export function summarizeUserLog(row) {
  const title = String(row?.title || "");
  const kind = classifyLogTitle(title);
  const parsed = parseLogData(row?.data);
  const provider = extractLogProvider(title, parsed, kind);
  const orderId = extractLogOrderId(title, parsed, kind);
  const target = extractLogTarget(parsed, kind, title);
  const acct = extractLogAccountLabel(title);
  const out = {
    id: row?.id,
    createAt: Number(row?.create_at) || 0,
    title,
    kind,
    provider,
    orderId: orderId || null,
    target: target || null,
    accountLabel: null,
    loseOrder: false,
    match: null,
    bet: null,
    item: null,
    odds: null,
    newOdds: null,
    betMoney: null,
    planBetMoney: null,
    stakeExchange: null,
    stakeRate: null,
    stakeCurrency: null,
    itemId: null,
    matchId: null,
    betId: null,
    success: null,
    message: null,
    checkError: null,
    requestAmount: null,
    requestOdds: null,
    related: true,
    relationScore: 0,
    relationReason: "",
    matchedOrderId: null,
    linkId: null,
    attemptType: null,
    failedLegOdds: null,
    failedPlatformLabel: null,
    placedAt: null,
    observedAt: null,
    rejectDelayMs: null,
    settlement: null,
    observedStatus: null,
    rejectReason: null,
    summary: title,
  };

  if (acct)
    out.accountLabel = acct.label;

  if (kind === "check" && parsed?.options) {
    const o = parsed.options;
    out.linkId = Number(o.linkId) || null;
    out.attemptType = o.attemptType || null;
    out.target = out.target || (o.target === "Home" || o.target === "Away" ? o.target : null);
    out.loseOrder = Boolean(o.loseOrder);
    out.match = o.match || null;
    out.bet = o.bet || null;
    out.odds = Number(o.odds) || null;
    out.newOdds = Number(o.newOdds) || null;
    out.betMoney = Number(o.betMoney) || null;
    out.planBetMoney = Number(o.planBetMoney) || null;
    out.stakeExchange = Number(o.stakeExchange) || null;
    out.stakeRate = Number(o.stakeRate) || null;
    out.stakeCurrency = o.stakeCurrency || null;
    out.itemId = o.itemId || null;
    out.matchId = o.matchId || null;
    out.betId = o.betId || null;
    out.checkError = parsed.checkError || null;
    const req = parseObRequestLine(parsed.data);
    out.requestAmount = req.betMoney ?? null;
    out.requestOdds = req.odds ?? null;
    if (req.itemId)
      out.itemId = out.itemId || req.itemId;
    out.summary = `${o.type} 预检 ${o.match || ""} ${o.bet || ""} ${o.target}@${o.odds} 金额${o.betMoney}`;
    if (parsed.checkError)
      out.summary += ` · ${parsed.checkError}`;
    else if (parsed.response?.data)
      out.summary += ` · ${parsed.response.data}`;
  }
  else if (kind === "bet" && parsed?.result) {
    const r = parsed.result;
    out.linkId = Number(r.link) || null;
    out.attemptType = r.diagnosticAttempt || null;
    const req = parseObRequestLine(r.request);
    out.success = Boolean(r.success);
    out.message = r.message || null;
    out.requestAmount = req.betMoney ?? null;
    out.requestOdds = req.odds ?? null;
    out.betMoney = req.betMoney ?? null;
    out.odds = req.odds ?? null;
    out.itemId = req.itemId ?? null;
    out.summary = [
      `${r.provider} 下注 ${r.success ? "成功" : "失败"}`,
      req.odds ? `赔率${req.odds}` : "",
      req.betMoney ? `金额${req.betMoney}` : "",
      r.message || "",
    ].filter(Boolean).join(" · ");
  }
  else if (kind === "reject") {
    out.linkId = Number(parsed?.linkId) || null;
    out.attemptType = parsed?.attemptType || null;
    out.message = parsed?.rejectReason || title;
    out.target = parsed?.target === "Home" || parsed?.target === "Away"
      ? parsed.target
      : out.target;
    out.match = parsed?.match || null;
    out.bet = parsed?.bet || null;
    out.odds = Number(parsed?.odds) || null;
    out.betMoney = Number(parsed?.betMoney) || null;
    out.loseOrder = Boolean(parsed?.loseOrder);
    out.placedAt = Number(parsed?.placedAt) || null;
    out.observedAt = Number(parsed?.observedAt) || null;
    out.rejectDelayMs = Number(parsed?.rejectDelayMs) || null;
    out.settlement = parsed?.settlement || null;
    out.observedStatus = parsed?.observedStatus || null;
    out.rejectReason = parsed?.rejectReason || null;
    if (parsed?.diagnosticVersion) {
      const state = parsed.settlement === "unfilled"
        ? "确认拒单"
        : parsed.settlement === "timeout"
          ? "仍待确认"
          : "确认成交";
      out.summary = `${provider || "场馆"} 拒单检测 · ${state}`;
      if (out.rejectDelayMs)
        out.summary += ` · 间隔${Math.round(out.rejectDelayMs / 100) / 10}秒`;
      if (out.rejectReason)
        out.summary += ` · ${out.rejectReason}`;
    }
  }
  else if (kind === "makeup_queue") {
    out.linkId = Number(parsed?.linkId) || null;
    out.attemptType = "makeup_queue";
    out.target = parsed?.target === "Home" || parsed?.target === "Away"
      ? parsed.target
      : null;
    out.match = parsed?.match || null;
    out.bet = parsed?.bet || null;
    out.betMoney = Number(parsed?.betMoney) || null;
    out.odds = Number(parsed?.odds) || null;
    out.failedLegOdds = Number(parsed?.failedLegOdds) || null;
    out.failedPlatformLabel = parsed?.failedPlatformLabel || null;
    out.observedAt = Number(parsed?.observedAt) || out.createAt;
    out.summary = `补单入队 · ${out.target || "未知方向"} · 锚腿 ${out.betMoney || "—"}@${out.odds || "—"}`;
    if (out.failedPlatformLabel)
      out.summary += ` · 失败腿 ${out.failedPlatformLabel}@${out.failedLegOdds || "—"}`;
  }
  else if (kind === "makeup_cancel") {
    out.linkId = Number(parsed?.linkId) || null;
    out.attemptType = "makeup_cancel";
    out.target = parsed?.target === "Home" || parsed?.target === "Away"
      ? parsed.target
      : null;
    out.match = parsed?.match || null;
    out.bet = parsed?.bet || null;
    out.betId = parsed?.betId || null;
    out.failedPlatformLabel = parsed?.failedPlatformLabel || null;
    out.observedAt = Number(parsed?.observedAt) || out.createAt;
    out.message = parsed?.reason || "锚腿确认拒单，补单队列已撤销";
    out.summary = `补单取消 · ${out.target || "未知方向"} · ${out.message}`;
  }

  return out;
}

function normalizeOrderRow(row) {
  if (!row)
    return null;
  const raw = row.raw && typeof row.raw === "object" && !Array.isArray(row.raw) ? row.raw : {};
  const pfSide = String(raw.pfSide || raw.PfSide || "").toLowerCase();
  const pmSide = String(raw.pmSide || raw.PmSide || "").toLowerCase();
  const pmSellProceeds = Number(raw.pmSellProceeds ?? raw.PmSellProceeds);
  const pfSellProceeds = Number(raw.pfSellProceeds ?? raw.PfSellProceeds);
  const pe = raw.positionEvents && typeof raw.positionEvents === "object" && !Array.isArray(raw.positionEvents)
    ? raw.positionEvents
    : null;
  const sellsRaw = pe && Array.isArray(pe.sells) ? pe.sells : null;
  const positionEvents = sellsRaw && sellsRaw.length
    ? {
        sells: sellsRaw
          .map((ev) => {
            if (!ev || typeof ev !== "object")
              return null;
            const id = String(ev.id ?? "").trim();
            if (!id)
              return null;
            const out = { id };
            if (ev.at != null)
              out.at = Number(ev.at) || 0;
            if (ev.shares != null)
              out.shares = Number(ev.shares);
            if (ev.price != null)
              out.price = Number(ev.price);
            if (ev.proceeds != null)
              out.proceeds = Number(ev.proceeds);
            if (ev.pnl != null)
              out.pnl = Number(ev.pnl);
            const origin = String(ev.origin || "").toLowerCase();
            if (origin === "changmen" || origin === "external")
              out.origin = origin;
            if (ev.status != null)
              out.status = String(ev.status);
            return out;
          })
          .filter(Boolean),
      }
    : undefined;
  return {
    orderId: String(row.order_id),
    link: Number(row.link) || 0,
    provider: row.provider,
    playerId: row.player_id,
    match: row.match,
    bet: row.bet,
    item: row.item,
    odds: Number(row.odds) || 0,
    betMoney: Number(row.bet_money) || 0,
    money: Number(row.money) || 0,
    status: row.status,
    createAt: Number(row.create_at) || 0,
    pfSide: pfSide === "buy" || pfSide === "sell" ? pfSide : undefined,
    pmSide: pmSide === "buy" || pmSide === "sell" ? pmSide : undefined,
    ...(Number.isFinite(pmSellProceeds) ? { pmSellProceeds } : {}),
    ...(Number.isFinite(pfSellProceeds) ? { pfSellProceeds } : {}),
    ...(positionEvents?.sells?.length ? { positionEvents } : {}),
  };
}

function footballOrderToLogOrderRow(row) {
  if (!row)
    return null;
  return {
    order_id: row.venue_order_id,
    link: 0,
    provider: row.venue || "OB",
    player_id: row.player_id,
    match: [row.home, row.away].filter(Boolean).join(" vs "),
    bet: row.market_label,
    item: row.side_label,
    odds: row.odds,
    bet_money: row.stake,
    money: row.profit,
    status: row.status,
    create_at: row.placed_at,
    raw: {
      domain: "sports",
      sport: "football",
      source: "football_orders",
      podClientId: row.client_id,
    },
  };
}

async function resolveLookupUser(opts) {
  const userId = String(opts?.userId || "").trim();
  if (userId)
    return fetchUserById(userId);
  const userName = String(opts?.userName || "").trim();
  if (userName)
    return fetchUserByName(userName);
  return null;
}

/** 管理端 API：不含 logsRaw */
export function toAdminOrderLogPayload(result) {
  if (!result.ok)
    return result;
  const orders = result.orders || [];
  const logs = result.logs || [];
  const unrelatedLogs = result.unrelatedLogs || [];
  return {
    ok: true,
    user: result.user,
    anchor: result.anchor,
    link: result.link,
    linkType: result.linkType,
    groupLabel: result.groupLabel,
    logWindow: result.logWindow,
    observation: result.observation,
    orders,
    logs,
    unrelatedLogs,
    logStats: result.logStats || {
      total: logs.length,
      related: logs.length,
      unrelated: unrelatedLogs.length,
      truncated: false,
      limit: 0,
    },
    platforms: buildPlatformSections(orders, logs),
    orderSections: buildOrderSections(orders, logs),
    legSections: buildLegSections(orders, logs, {
      groupLabel: result.groupLabel,
      linkType: result.linkType,
    }),
  };
}

/** [changmen 扩展] 精确观察查询，不推造订单或扩展旧日志时间窗。 */
async function lookupObservationOnly(user, anchor, link = 0, selector = {}) {
  const observation = summarizeOrderObservations(await fetchOrderObservations(user.id, link, 2000, [], selector));
  if (!observation.events?.length)
    return { ok: false, error: observation.status === "unavailable" ? "执行观察记录暂不可用" : "未找到订单或执行记录（可能尚未上传）" };
  const times = observation.events.map(event => event.occurredAt);
  return { ok: true, user: { id: user.id, userName: user.user_name }, anchor, link, linkType: linkTypeLabel(link), groupLabel: "执行观察记录", observation, logWindow: { fromMs: Math.min(...times), toMs: Math.max(...times) }, orders: [], logs: [], unrelatedLogs: [], logsRaw: [], logStats: { total: 0, related: 0, unrelated: 0, truncated: false, limit: 2000 } };
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

  if (opts?.executionId || opts?.attemptId) {
    const key = opts.executionId ? "executionId" : "attemptId";
    const value = String(opts[key]);
    if (!/^[\w-]{8,160}$/.test(value))
      return { ok: false, error: "无效执行编号" };
    return lookupObservationOnly(user, { type: key, value }, 0, { [key]: value });
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
      return lookupObservationOnly(user, anchor, linkVal);
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
  const observation = summarizeOrderObservations(await fetchOrderObservations(user.id, link, 2000, normalized.map(order => ({ provider: order.provider, accountId: String(order.playerId), orderId: order.orderId }))));
  return {
    ok: true,
    user: { id: user.id, userName: user.user_name },
    anchor,
    link,
    linkType: linkTypeLabel(link),
    observation,
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

/** CLI / 管理输出 */
export function formatLookupReport(result) {
  if (!result.ok) {
    return [`错误: ${result.error}`, result.user ? `用户: ${result.user.userName}` : ""]
      .filter(Boolean)
      .join("\n");
  }

  const lines = [];
  lines.push(`用户: ${result.user.userName} (${result.user.id})`);
  lines.push(
    `锚点: ${result.anchor.type}=${result.anchor.value} · Link ${result.link} · ${result.linkType} · ${result.groupLabel}`,
  );
  lines.push(
    `日志窗口: ${formatCnTime(result.logWindow.fromMs)} — ${formatCnTime(result.logWindow.toMs)}`,
  );
  lines.push("");
  lines.push("── 订单 ──");
  for (const o of result.orders) {
    lines.push(
      [
        formatCnTime(o.createAt),
        o.provider,
        o.status,
        `${o.item}@${o.odds}`,
        `¥${o.betMoney}`,
        `order=${o.orderId}`,
      ].join(" · "),
    );
  }
  lines.push("");
  lines.push(`── user_logs (${result.logs.length}) ──`);
  for (const log of result.logs) {
    lines.push(`${formatCnTime(log.createAt)} [${log.kind}] ${log.summary}`);
  }
  if (!result.logs.length) {
    lines.push("（该时间窗内无 Client_SaveUserLog 记录）");
  }
  return lines.join("\n");
}

export function formatCnTime(ts) {
  const n = Number(ts);
  if (!n)
    return "—";
  return new Date(n).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

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

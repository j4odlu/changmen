import { ARB_LINK_MIN, DEFAULT_LOG_PADDING_MS } from "./rules.js";
import { buildLogSegments } from "./logs.js";

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

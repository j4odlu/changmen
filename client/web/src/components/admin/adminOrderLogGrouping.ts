import type { AdminOrderLogAttempt, AdminOrderLogEntry, AdminOrderLogLegSection, AdminOrderLogLookup } from "@/types/admin";

const ARB_LINK_MIN = 1_000_000_000_000;

function isArbLookup(payload: AdminOrderLogLookup) {
  if (payload.linkType === "套利" || payload.groupLabel.includes("套利"))
    return true;
  const orders = payload.orders || [];
  return orders.length > 1 && orders.every(o => Number(o.link) >= ARB_LINK_MIN);
}

function assignOrphanLogs(attempts: AdminOrderLogAttempt[], orphanLogs: AdminOrderLogEntry[]) {
  if (!orphanLogs.length)
    return;
  if (!attempts.length) {
    attempts.push({ key: "orphan", order: null, logs: [...orphanLogs] });
    return;
  }
  for (const log of orphanLogs) {
    let best = attempts[0]!;
    let bestDist = Math.abs(log.createAt - (best.order?.createAt ?? log.createAt));
    for (const att of attempts.slice(1)) {
      const dist = Math.abs(log.createAt - (att.order?.createAt ?? 0));
      if (dist < bestDist) {
        bestDist = dist;
        best = att;
      }
    }
    best.logs.push(log);
  }
}

function inferTargetFromLogs(logs: AdminOrderLogEntry[]) {
  for (const log of logs) {
    if (log.target === "Home" || log.target === "Away")
      return log.target;
  }
  for (const log of logs) {
    const m = String(log.summary || "").match(/\s(Home|Away)@/);
    if (m)
      return m[1] as "Home" | "Away";
  }
  return null;
}

export function sideLabel(leg: AdminOrderLogLegSection) {
  return leg.side === "Away" ? "客队" : "主队";
}

export function attemptProvider(attempt: AdminOrderLogAttempt) {
  return attempt.order?.provider ?? null;
}

function touchLegProvider(leg: AdminOrderLogLegSection, provider: string | null | undefined) {
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

function pickLegIndexForUnassigned(legs: AdminOrderLogLegSection[]) {
  const homeN = legs[0]!.attempts.length;
  const awayN = legs[1]!.attempts.length;
  if (homeN && !awayN)
    return 1;
  if (!homeN && awayN)
    return 0;
  return homeN <= awayN ? 0 : 1;
}

function resolveLegIndexByProvider(provider: string | null | undefined, legs: AdminOrderLogLegSection[]) {
  if (!provider)
    return pickLegIndexForUnassigned(legs);
  for (let i = 0; i < 2; i++) {
    if (legs[i]!.provider === provider || legs[i]!.provider?.includes(provider))
      return i;
    for (const att of legs[i]!.attempts) {
      if (att.order?.provider === provider)
        return i;
    }
  }
  return pickLegIndexForUnassigned(legs);
}

/** 旧后端无 legSections 时前端兜底（主客队） */
export function fallbackLegSections(payload: AdminOrderLogLookup): AdminOrderLogLegSection[] {
  const sortedOrders = [...payload.orders].sort((a, b) => a.createAt - b.createAt);
  const sortedLogs = [...payload.logs].sort((a, b) => a.createAt - b.createAt);
  const isArb = isArbLookup(payload);

  const legs: AdminOrderLogLegSection[] = [
    { key: "leg-home", legIndex: 0, side: "Home", label: "主队", provider: null, attempts: [] },
    { key: "leg-away", legIndex: 1, side: "Away", label: "客队", provider: null, attempts: [] },
  ];

  const attempts = sortedOrders.map(order => ({
    key: order.orderId,
    order,
    logs: [] as AdminOrderLogEntry[],
  }));
  const attemptByOrderId = new Map(attempts.map(a => [a.order.orderId, a]));
  const orphanLogs: AdminOrderLogEntry[] = [];

  for (const log of sortedLogs) {
    const orderId = log.orderId ? String(log.orderId) : null;
    if (orderId && attemptByOrderId.has(orderId)) {
      attemptByOrderId.get(orderId)!.logs.push(log);
    }
    else {
      orphanLogs.push(log);
    }
  }

  for (const att of attempts) {
    att.logs.sort((a, b) => a.createAt - b.createAt);
    const side = inferTargetFromLogs(att.logs);
    const legIdx
      = side === "Away" ? 1 : side === "Home" ? 0 : pickLegIndexForUnassigned(legs);
    legs[legIdx]!.attempts.push(att);
    touchLegProvider(legs[legIdx]!, att.order.provider);
  }

  for (const leg of legs) {
    leg.attempts.sort((a, b) => (a.order?.createAt ?? 0) - (b.order?.createAt ?? 0));
  }

  const orphanBySide: { Home: AdminOrderLogEntry[]; Away: AdminOrderLogEntry[]; unknown: AdminOrderLogEntry[] } = {
    Home: [],
    Away: [],
    unknown: [],
  };
  for (const log of orphanLogs) {
    const side
      = log.target === "Home" || log.target === "Away"
        ? log.target
        : (String(log.summary || "").match(/\s(Home|Away)@/)?.[1] as "Home" | "Away" | undefined);
    if (side === "Home")
      orphanBySide.Home.push(log);
    else if (side === "Away")
      orphanBySide.Away.push(log);
    else orphanBySide.unknown.push(log);
  }

  assignOrphanLogs(legs[0]!.attempts, orphanBySide.Home);
  assignOrphanLogs(legs[1]!.attempts, orphanBySide.Away);
  for (const log of orphanBySide.unknown) {
    const idx = resolveLegIndexByProvider(log.provider, legs);
    assignOrphanLogs(legs[idx]!.attempts, [log]);
    touchLegProvider(legs[idx]!, log.provider);
  }

  for (const leg of legs) {
    leg.label = sideLabel(leg);
  }

  if (isArb)
    return legs;
  return legs.filter(leg => leg.attempts.some(a => a.order || a.logs.length > 0));
}

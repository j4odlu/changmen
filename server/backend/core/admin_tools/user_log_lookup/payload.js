import { linkTypeLabel } from "./rules.js";
import { buildPlatformSections, buildOrderSections, buildLegSections } from "./sections.js";
import { summarizeOrderObservations } from "../order_observation.js";

export function normalizeOrderRow(row) {
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

export function footballOrderToLogOrderRow(row) {
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
    diagnosticSource: result.diagnosticSource,
    legacyLogsLoaded: result.legacyLogsLoaded,
    ordersQueried: result.ordersQueried,
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
    legSections: result.legacyLogsLoaded === false ? [] : buildLegSections(orders, logs, {
      groupLabel: result.groupLabel,
      linkType: result.linkType,
    }),
  };
}

/** [changmen 扩展] 精确观察查询，不推造订单或扩展旧日志时间窗。 */
export function diagnosticOrderRecords(orders) {
  return orders.map(order => ({ orderId: String(order.order_id), provider: String(order.provider || ""),
    accountId: Number(order.player_id), linkId: Number(order.link) || 0, status: String(order.status || ""),
    shares: Number.isFinite(Number(order.raw?.pmShares)) ? Number(order.raw.pmShares) || undefined : undefined,
    side: ["buy", "sell"].includes(order.raw?.pmSide) ? order.raw.pmSide : undefined,
  }));
}

export function directObservationResult(user, anchor, link, query, orders, ordersQueried) {
  const observation = summarizeOrderObservations(query, diagnosticOrderRecords(orders));
  const times = observation.events.map(event => event.occurredAt);
  return { ok: true, user: { id: user.id, userName: user.user_name }, anchor, link,
    linkType: linkTypeLabel(link), groupLabel: "执行记录诊断", observation,
    diagnosticSource: "events", legacyLogsLoaded: false, ordersQueried,
    logWindow: { fromMs: Math.min(...times), toMs: Math.max(...times) },
    orders: orders.map(normalizeOrderRow).filter(Boolean), logs: [], unrelatedLogs: [], logsRaw: [],
    logStats: { total: 0, related: 0, unrelated: 0, truncated: false, limit: 0 } };
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

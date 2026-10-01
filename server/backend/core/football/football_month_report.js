/**
 * 足球月报：只聚合 football_orders 中的 OB 订单。
 * 禁止读写电竞 orders / money_logs，禁止引用电竞月报模块。
 */
import * as sb from "@changmen/db";

function monthBounds(month) {
  const m = month || new Date().toISOString().slice(0, 7);
  const [year, mon] = String(m).split("-").map(Number);
  if (!year || !mon) {
    const now = new Date();
    return monthBounds(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  }
  const days = new Date(year, mon, 0).getDate();
  return { month: `${year}-${String(mon).padStart(2, "0")}`, year, mon, days };
}

function dateKeyForDay(year, mon, day) {
  return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toLocalDateKey(ts) {
  const d = new Date(Number(ts) || 0);
  if (!Number.isFinite(d.getTime()) || d.getTime() <= 0)
    return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyRow(dateKey) {
  return {
    Date: String(dateKey),
    Profit: 0,
    OrderCount: 0,
    BetMoney: 0,
    Rate: 0,
  };
}

function finalizeRow(row) {
  row.Rate = row.BetMoney > 0 ? row.Profit / row.BetMoney : 0;
  return row;
}

function isReject(status) {
  return String(status || "") === "Reject";
}

function isUnsettled(status) {
  const s = String(status || "None");
  return s === "None" || s === "Pending";
}

/**
 * @param {string} [month]
 * @param {Array<{ placed_at?: number, placedAt?: number, stake?: number, profit?: number, status?: string, venue?: string }>} rows
 */
export function aggregateFootballMonthRows(month, rows) {
  const { month: m, year, mon, days } = monthBounds(month);
  const byDate = new Map();
  for (let day = 1; day <= days; day += 1) {
    const key = dateKeyForDay(year, mon, day);
    byDate.set(key, emptyRow(key));
  }

  for (const o of rows || []) {
    if (String(o.venue || "OB").trim().toUpperCase() !== "OB")
      continue;
    if (isReject(o.status))
      continue;
    const key = toLocalDateKey(o.placed_at ?? o.placedAt);
    const row = byDate.get(key);
    if (!row)
      continue;
    row.OrderCount += 1;
    row.BetMoney += Number(o.stake) || 0;
    if (!isUnsettled(o.status))
      row.Profit += Number(o.profit) || 0;
  }

  const list = [];
  const total = emptyRow("total");
  for (let day = 1; day <= days; day += 1) {
    const row = finalizeRow(byDate.get(dateKeyForDay(year, mon, day)));
    list.push(row);
    total.Profit += row.Profit;
    total.OrderCount += row.OrderCount;
    total.BetMoney += row.BetMoney;
  }
  finalizeRow(total);
  return { month: m, list, total };
}

/** 足球月报：userId 单用户；userIds 团队/可见集（[] = 无成员，非全站） */
export async function getFootballMonthReport(month, userId, userIds) {
  const { month: m } = monthBounds(month);
  const uid = userId ? String(userId).trim() : "";
  const emptyScope = !uid && Array.isArray(userIds) && userIds.length === 0;
  const rows = emptyScope
    ? []
    : await sb.fetchFootballOrdersForMonthAggregate(m, uid || undefined, userIds);
  const payload = aggregateFootballMonthRows(m, rows);
  return { ...payload, userId: uid || undefined };
}

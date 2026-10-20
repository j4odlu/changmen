/** YYYY-MM → 本地时区当月 [start, end) 毫秒 */
export function localMonthBounds(monthKey) {
  const parts = String(monthKey || "").split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  if (!y || !m) {
    const now = new Date();
    return localMonthBounds(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  }
  const monthStart = new Date(y, m - 1, 1, 0, 0, 0, 0).getTime();
  const monthEnd = new Date(y, m, 1, 0, 0, 0, 0).getTime();
  return { monthStart, monthEnd };
}

/** YYYY-MM-DD → 本地时区当日 [start, end) 毫秒 */
export function localDayBounds(dateKey) {
  const parts = String(dateKey || "").split("-").map(Number);
  if (parts.length < 3 || parts.some(n => !Number.isFinite(n))) {
    const now = Date.now();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { dayStart: start.getTime(), dayEnd: start.getTime() + 86400000 };
  }
  const [y, m, d] = parts;
  const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const dayEnd = new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime();
  return { dayStart, dayEnd };
}

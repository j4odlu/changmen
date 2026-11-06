/** 订单读写共用的纯字段转换；不依赖 DTO、数据库或场馆服务。 */
export function parseNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizePmMatchResult(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "win" || s === "lose" || s === "equal_split")
    return s;
  return undefined;
}

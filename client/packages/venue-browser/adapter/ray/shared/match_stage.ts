/** RAY 源站 match_stage → Map（与 A8 l$、backend matchStageToId 一致） */
export function rayMatchStage(matchStage: unknown): number {
  if (matchStage === "final") return 0;
  if (matchStage != null && typeof matchStage === "object" && "toNumber" in matchStage) {
    const fn = (matchStage as { toNumber?: () => number }).toNumber;
    if (typeof fn === "function") {
      const n = fn.call(matchStage);
      return Number.isFinite(n) ? n : 0;
    }
  }
  const s = String(matchStage ?? "").trim().toLowerCase();
  if (!s || s === "final") return 0;
  const rPrefix = s.match(/^r(\d+)$/);
  if (rPrefix) return Number(rPrefix[1]) || 0;
  const digits = s.replace(/[^\d.-]/g, "");
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

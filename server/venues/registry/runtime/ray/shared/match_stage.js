/** ESM（探针 core.js / CLI）；浏览器 canonical 见 platform-adapter/ray/shared/match_stage.ts */
export function rayMatchStage(matchStage) {
  if (matchStage === "final") return 0;
  if (matchStage != null && typeof matchStage === "object" && "toNumber" in matchStage) {
    const fn = matchStage.toNumber;
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

import { isPlaceholderTeamName } from "./match_utils.js";

/** 标准队名：有 OB 映射时用 OB platform_name，否则用 canonical_teams 存盘名 */
export function resolveCanonicalTeamName(obName, storedName) {
  const ob = String(obName ?? "").trim();
  if (ob && !isPlaceholderTeamName(ob))
    return ob;
  const stored = String(storedName ?? "").trim();
  return stored || null;
}

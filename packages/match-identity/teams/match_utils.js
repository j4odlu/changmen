/** 单场地图序号槽位（map 0..4095）；与 clientMatchId 组合为唯一 bet ID */
export const BET_MAP_SLOT = 4096;

export function stableId(seed) {
  let h = 0;
  for (const c of String(seed)) h = (Math.imul(31, h) + c.charCodeAt(0)) >>> 0;
  return h || 1;
}

/**
 * 已分配 client_matches.id 的盘口行 ID：`(matchId * BET_MAP_SLOT + map)`，同场不同 map 唯一、跨场不碰撞。
 * 替代 `stableId(\`bet:${matchId}:${map}\`)` 的 32 位哈希碰撞。
 */
export function stableBetId(clientMatchId, map = 0) {
  const m = Math.floor(Number(clientMatchId)) || 0;
  const p = Math.floor(Number(map)) || 0;
  if (m <= 0)
    return stableId(`bet:unassigned:${p}`);
  if (p < 0 || p >= BET_MAP_SLOT) {
    throw new Error(`bet Map 超出范围 0..${BET_MAP_SLOT - 1}: ${p}`);
  }
  const id = m * BET_MAP_SLOT + p;
  return id > 0 ? id : 1;
}

/** merge 阶段尚未写入 client_matches.id 时的临时 bet ID（按 mergeKey 哈希） */
export function stablePendingBetId(mergeKey, map = 0) {
  return stableId(`bet:pending:${String(mergeKey)}:${Math.floor(Number(map)) || 0}`);
}

export function formatTitle(home, away) {
  const h = String(home || "").trim();
  const a = String(away || "").trim();
  if (h && a)
    return `${h} vs ${a}`;
  return h || a || "Unknown";
}

export function betKey(provider, sourceMatchId) {
  return `${provider}:${sourceMatchId}`;
}

export function isPlaceholderTeamName(name) {
  const t = String(name || "").trim();
  return !t || t === "主队" || t === "客队" || t === "Unknown";
}

/** `Title` 形如「主队 vs 客队」→ { home, away } */
export function parseTitleTeams(title) {
  const t = String(title || "").trim();
  if (!t.includes(" vs "))
    return null;
  const parts = t.split(" vs ").map(s => s.trim());
  if (parts.length < 2)
    return null;
  const [home, away] = parts;
  if (isPlaceholderTeamName(home) || isPlaceholderTeamName(away))
    return null;
  return { home, away };
}

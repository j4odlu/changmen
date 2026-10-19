/** IM 盘口文案解析（对齐 A8 聚合 Socket 推送的 BetName） */

const CN_DIGIT: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

export function pickImSportId(obj: Record<string, unknown>): string {
  return pickA8Field(
    obj,
    "sportId",
    "SportId",
    "sportID",
    "gameId",
    "GameId",
    "gameID",
    "spid",
    "SpId",
    "sid",
  );
}

export function pickA8Field(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && v !== "") return String(v);
  }
  return "";
}

/** A8 GameID（catalog a8GameId）→ IM SportId */
export const IM_SPORT_BY_GAME_ID = new Map<number, string>([
  [1, "45"],
  [2, "46"],
  [3, "47"],
  [4, "48"],
  [8, "65"],
]);

export function imSportIdForGame(gameId: number): string | undefined {
  return IM_SPORT_BY_GAME_ID.get(gameId);
}

export function imA8GameIdFromSportId(sportId: string | number | undefined): number | undefined {
  if (sportId == null || sportId === "") return undefined;
  const s = String(sportId);
  for (const [a8, im] of IM_SPORT_BY_GAME_ID) {
    if (im === s) return a8;
  }
  return undefined;
}

/** 全场 / BO3 总盘（非「第 N 局」） */
export function imBetNameIsFullMatch(name: string): boolean {
  const text = String(name || "").replace(/\s+/g, "");
  if (!text) return false;
  if (/全场|总比赛|系列赛|BO\d/i.test(text)) return true;
  if ((/比赛.*胜|胜负/.test(text) || /获胜/.test(text)) && !/第.+局/.test(text)) return true;
  return false;
}

/** 「第 一 局胜利 (滚球)」→ 1；全场类 → 0 */
export function parseImMapFromBetName(name: string): number {
  const text = String(name || "").replace(/\s+/g, "");
  if (!text || imBetNameIsFullMatch(name)) return 0;
  const m = text.match(/第([一二三四五六七八九十\d]+)局/);
  if (!m) return 0;
  const token = m[1];
  if (/^\d+$/.test(token)) return Number(token) || 0;
  if (token.length === 1) return CN_DIGIT[token] ?? 0;
  if (token === "十") return 10;
  if (token.startsWith("十") && token.length === 2) return CN_DIGIT[token[1]] ?? 0;
  if (token.endsWith("十") && token.length === 2) return (CN_DIGIT[token[0]] ?? 0) * 10;
  return 0;
}

/** 地图胜负（第 N 局） */
export function imBetNameIsMapWinner(name: string): boolean {
  const text = String(name || "");
  if (!text || imBetNameIsFullMatch(name)) return false;
  return /第\s*.+\s*局.*胜/.test(text) || /局.*胜利/.test(text);
}

/** 采集保留：全场 + 各地图胜负；空名称时由 socket map 决定 */
export function imBetNameIsCollectible(name: string): boolean {
  if (!name) return true;
  return imBetNameIsFullMatch(name) || imBetNameIsMapWinner(name);
}

export function resolveImMapFromBet(bet: { map?: unknown; name?: string; BetName?: string }): number {
  const name = pickA8Field(bet as Record<string, unknown>, "name", "Name", "betName", "BetName");
  if (name && imBetNameIsFullMatch(name)) return 0;
  const fromName = name ? parseImMapFromBetName(name) : 0;
  if (fromName > 0) return fromName;
  const raw = bet.map ?? (bet as { Map?: unknown }).Map;
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function formatImBetLabel(map: number, rawName?: string): string {
  if (rawName) return String(rawName);
  return map === 0 ? "全场胜负" : `地图${map}胜负`;
}

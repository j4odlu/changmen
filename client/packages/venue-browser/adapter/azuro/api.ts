import { normalizeEpochMs } from "@changmen/shared/time/match_time";
import { directGet, directPostJson } from "@changmen/client-core/shared/http";

import type { AzuroCondition, AzuroGame } from "./parse";

export const AZURO_API = "https://api.onchainfeed.org/api/v1/public";
export const AZURO_WS = "wss://streams.onchainfeed.org/v1/streams/feed";

/** [changmen 扩展] Polygon USDT 主网环境（Azuro 官方 Market Manager API） */
export const AZURO_ENVIRONMENT = "PolygonUSDT";

/** Azuro sportId → catalog code（仅电竞） */
export const AZURO_ESPORT_SPORT_IDS: Record<string, string> = {
  "1061": "cs2",
  "1002": "lol",
  "1000": "dota2",
};

const COLLECT_PAST_MS = 6 * 3600 * 1000;
const COLLECT_FUTURE_MS = 3600 * 1000;
const PAGE_SIZE = 50;
const MAX_PAGES = 4;

export const AZURO_COLLECT_PAST_MS = COLLECT_PAST_MS;
export const AZURO_COLLECT_FUTURE_MS = COLLECT_FUTURE_MS;

export function azuroCollectStartTimeAllowed(startMs: number): boolean {
  const ms = normalizeEpochMs(startMs);
  if (!ms)
    return true;
  const now = Date.now();
  return ms >= now - COLLECT_PAST_MS && ms <= now + COLLECT_FUTURE_MS;
}

interface GamesByFiltersResponse {
  games?: AzuroGame[];
  totalPages?: number;
}

interface ConditionsByGameIdsResponse extends Array<AzuroCondition> {}

function gamesQuery(sportId: string, gameState: "Prematch" | "Live", page: number): string {
  const params = new URLSearchParams({
    environment: AZURO_ENVIRONMENT,
    gameState,
    orderBy: "startsAt",
    orderDirection: "asc",
    sportId,
    page: String(page),
    perPage: String(PAGE_SIZE),
  });
  return `${AZURO_API}/market-manager/games-by-filters?${params.toString()}`;
}

export async function fetchAzuroEsportsGames(
  sportId: string,
  gameState: "Prematch" | "Live",
): Promise<AzuroGame[]> {
  const games: AzuroGame[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await directGet<GamesByFiltersResponse>(gamesQuery(sportId, gameState, page), {});
    const batch = Array.isArray(res?.games) ? res.games : [];
    games.push(...batch);
    const totalPages = Number(res?.totalPages ?? page);
    if (page >= totalPages || !batch.length)
      break;
  }
  return games;
}

export async function fetchAllAzuroEsportsGames(): Promise<AzuroGame[]> {
  const sportIds = Object.keys(AZURO_ESPORT_SPORT_IDS);
  const states: Array<"Prematch" | "Live"> = ["Prematch", "Live"];
  const rows = await Promise.all(
    sportIds.flatMap(sportId => states.map(state => fetchAzuroEsportsGames(sportId, state))),
  );
  const byId = new Map<string, AzuroGame>();
  for (const list of rows) {
    for (const game of list) {
      const id = String(game.gameId ?? game.id ?? "");
      if (id)
        byId.set(id, game);
    }
  }
  return [...byId.values()];
}

export async function fetchAzuroConditions(gameIds: string[]): Promise<AzuroCondition[]> {
  const unique = [...new Set(gameIds.filter(Boolean))];
  if (!unique.length)
    return [];
  const res = await directPostJson<ConditionsByGameIdsResponse | { conditions?: AzuroCondition[] }>(
    `${AZURO_API}/market-manager/conditions-by-game-ids`,
    {},
    { environment: AZURO_ENVIRONMENT, gameIds: unique },
  );
  if (Array.isArray(res))
    return res;
  return Array.isArray(res?.conditions) ? res.conditions : [];
}

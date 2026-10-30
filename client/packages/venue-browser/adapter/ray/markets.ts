import { saveVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import { directGet } from "@changmen/client-core/shared/http";
import type { CollectBetDto } from "@changmen/client-core/types/collect";
import type { CollectPlatformInfo } from "@changmen/api-contract";
import { PLATFORMS } from "../shared/platforms";
import { updateRayMapOutcomes } from "./rayMapOutcome";
import { ingestRayBasketballSpreads } from "./basketballSpreads";

export { getRayBasketballSpreads, clearRayBasketballSpreads, ingestRayBasketballSpreads } from "./basketballSpreads";
export type { RayBasketballSpreadOption } from "./basketballSpreads";

import {
  groupRayOddsToSaveBets,
  listRayFoOddEntries,
  type RayOddsPayload,
} from "./shared/save_bets";

const PLATFORM = PLATFORMS.RAY;

/** 与 gamebet_backend/core/shared/ray_paths.js 保持一致 */
export function rayApiPath(gateway: string | undefined, apiPath: string): string {
  const base = String(gateway || "").replace(/\/+$/, "");
  let path = String(apiPath || "").replace(/^\//, "");
  if (base.endsWith("/v2")) {
    path = path.replace(/^v2\//, "");
    return `/${path}`;
  }
  if (path.startsWith("v2/")) return `/${path}`;
  return `/v2/${path}`;
}

function rayHeaders(token: string): Record<string, string> {
  const auth = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  return {
    authorization: auth,
    Accept: "application/json, text/plain, */*",
  };
}

/** A8 bQe：Nr.get 直连 RAY gateway */
export async function collectRayGet<T>(
  platform: CollectPlatformInfo,
  apiPath: string,
  query = "",
): Promise<T> {
  if (!platform.Gateway || !platform.Token) {
    throw new Error("RAY collect platform not configured");
  }
  const path = rayApiPath(platform.Gateway, apiPath);
  const base = platform.Gateway.replace(/\/+$/, "");
  const q = query ? (path.includes("?") ? "&" : "?") + query : "";
  const url = `${base}${path}${q}`;
  return directGet<T>(url, rayHeaders(platform.Token));
}

/** Ingest：v2/odds 快照写入 fo */
function ingestRayOddsPayloadToFo(
  result: RayOddsPayload,
  betRe: RegExp,
  gameCode?: string | null,
): void {
  const now = Date.now();
  for (const entry of listRayFoOddEntries(result, betRe, gameCode)) {
    saveVenueOdds(PLATFORM, { ...entry, time: now });
  }
}

/** Report：v2/odds 快照 → SaveBet 行 */
function reportRayOddsPayloadToSaveBetRows(
  result: RayOddsPayload,
  betRe: RegExp,
  gameCode?: string | null,
): CollectBetDto[] {
  return groupRayOddsToSaveBets(result, betRe, PLATFORM, gameCode) as CollectBetDto[];
}

/** 单场 odds：Ingest fo + 返回 Report 载荷 */
export async function loadRayBets(
  platform: CollectPlatformInfo,
  matchId: string,
  betRe: RegExp,
  gameCode?: string | null,
): Promise<{ bets: CollectBetDto[]; matchResult?: Record<string, unknown> }> {
  const requestedAt = Date.now();
  const res = await collectRayGet<{ code: number; result?: Record<string, unknown> }>(
    platform,
    "odds",
    `match_id=${matchId}`,
  );
  if (res.code !== 200 || !res.result) return { bets: [] };

  const payload = res.result as unknown as RayOddsPayload;
  ingestRayBasketballSpreads(matchId, payload, gameCode, requestedAt);
  updateRayMapOutcomes(matchId, payload, betRe, gameCode);
  ingestRayOddsPayloadToFo(payload, betRe, gameCode);
  const { id, status, round, start_time } = res.result;
  // 仅透传原始字段；异常判断由 matcher 执行，不新增请求。
  const matchResult = {
    id, status, round, start_time,
    team: payload.team?.map(({ pos, team_id }) => ({ pos, team_id })),
    odds: payload.odds?.filter(row => row.group_name === "获胜者").map(row => ({
      match_stage: row.match_stage, odds_group_id: row.odds_group_id, odds_id: row.odds_id,
      team_id: row.team_id, status: row.status, win: row.win, group_name: row.group_name,
    })),
  };
  return { bets: reportRayOddsPayloadToSaveBetRows(payload, betRe, gameCode), matchResult };
}

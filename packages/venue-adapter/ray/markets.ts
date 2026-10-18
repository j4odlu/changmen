import { saveVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import { directGet } from "@changmen/client-core/shared/http";
import type { CollectBetDto } from "@changmen/client-core/types/collect";
import type { CollectPlatformInfo } from "@changmen/api-contract";
import { PLATFORMS } from "../shared/platforms";
import { updateRayMapOutcomes } from "./rayMapOutcome";

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
): Promise<CollectBetDto[]> {
  const res = await collectRayGet<{ code: number; result?: Record<string, unknown> }>(
    platform,
    "odds",
    `match_id=${matchId}`,
  );
  if (res.code !== 200 || !res.result) return [];

  const payload = res.result as unknown as RayOddsPayload;
  updateRayMapOutcomes(matchId, payload, betRe, gameCode);
  ingestRayOddsPayloadToFo(payload, betRe, gameCode);
  return reportRayOddsPayloadToSaveBetRows(payload, betRe, gameCode);
}

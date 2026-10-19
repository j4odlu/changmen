import { saveVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import type { CollectBetDto } from "@changmen/client-core/types/collect";
import type { CollectPlatformInfo } from "@changmen/api-contract";
import { PLATFORMS } from "../shared/platforms";

import {
  buildIaSaveBetRowsFromPlays,
  isIaChildCollectable,
  listIaChildFoOddEntries,
} from "./shared/save_bets";
import { betKeyFromChild } from "./shared/parse_fields";
import { iaCollectPost } from "./transport";

const PLATFORM = PLATFORMS.IA;

/** Ingest：可采集 child 写入 fo */
function ingestIaPlaysToFo(
  plays: Array<Record<string, unknown>>,
  betRe: RegExp,
): void {
  const now = Date.now();
  for (const play of plays) {
    const children = (play.child_plays ?? []) as Array<Record<string, unknown>>;
    for (const child of children) {
      const betKey = betKeyFromChild(child);
      if (!isIaChildCollectable(child, betKey, betRe)) continue;
      for (const entry of listIaChildFoOddEntries(child)) {
        saveVenueOdds(
          PLATFORM,
          {
            id: entry.id,
            odds: entry.odds,
            isLock: entry.isLock,
            betId: entry.betId,
            time: now,
          },
          "http",
        );
      }
    }
  }
}

/** Report：plays 快照 → SaveBet 行 */
function reportIaPlaysToSaveBetRows(
  plays: Array<Record<string, unknown>>,
  matchId: string,
  betRe: RegExp,
): CollectBetDto[] {
  return buildIaSaveBetRowsFromPlays(plays, matchId, betRe, PLATFORM);
}

/** 单场 getPointsListSplit：Ingest fo + 返回 Report 载荷 */
export async function loadIaBets(
  platform: CollectPlatformInfo,
  matchId: string,
  betRe: RegExp,
): Promise<CollectBetDto[]> {
  const res = await iaCollectPost<{ code?: number; data?: { plays?: Array<Record<string, unknown>> } }>(
    platform,
    "/api/game/game/getPointsListSplit",
    { game_id: matchId, lang: 1 },
  );
  if (res.code !== undefined && res.code !== 1) return [];

  const plays = res.data?.plays ?? [];
  ingestIaPlaysToFo(plays, betRe);
  return reportIaPlaysToSaveBetRows(plays, matchId, betRe);
}

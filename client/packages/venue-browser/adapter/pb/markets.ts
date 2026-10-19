import { saveVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import type { CollectBetDto, CollectMatchDto } from "@changmen/client-core/types/collect";
import { PLATFORMS } from "../shared/platforms";

import { isPbChangmenExtensions } from "./extensionsMode";
import { setPbLineId } from "./lineCache";
import { pbTeamLogo, type PbParsedMatch } from "./parse";
import {
  buildPbSaveBetRowsFromMatch,
  listPbStageFoEntries,
} from "./shared/save_bets";
import { isPbWsShadowUiAllowed } from "./wsStatusPoll";
import { rememberPbRotEvent, upsertPbWsShadowFromParsedMatch } from "./wsShadowOdds";

const PLATFORM = PLATFORMS.PB;

/** lineId 缓存与 fo 解耦：writeFo=false 时仍要刷，否则赛前下注缺 lineId */
function syncPbLineIdsFromParsedMatch(row: PbParsedMatch): void {
  for (const stage of row.stages) {
    if (stage.winLineId) setPbLineId(stage.winMarketId, stage.winLineId);
  }
}

/** Ingest：parse 后的单场 → fo + lineId 缓存 */
export function ingestPbParsedMatchToFo(row: PbParsedMatch, now = Date.now()): void {
  syncPbLineIdsFromParsedMatch(row);
  for (const stage of row.stages) {
    for (const entry of listPbStageFoEntries(stage)) {
      saveVenueOdds(PLATFORM, { ...entry, time: now });
    }
  }
}

export function buildPbCollectMatchDto(row: PbParsedMatch): CollectMatchDto {
  return {
    Type: PLATFORM,
    SourceMatchID: row.matchId,
    SourceGameID: row.gameId,
    BO: row.bo,
    StartTime: row.startTime,
    Home: row.home.name,
    HomeID: row.home.id,
    Away: row.away.name,
    AwayID: row.away.id,
    Teams: [
      {
        Type: PLATFORM,
        GameID: row.gameId,
        Name: row.home.name,
        TeamID: row.home.id,
        Logo: pbTeamLogo(row.gameId, row.home.englishName),
      },
      {
        Type: PLATFORM,
        GameID: row.gameId,
        Name: row.away.name,
        TeamID: row.away.id,
        Logo: pbTeamLogo(row.gameId, row.away.englishName),
      },
    ],
    // A8 `mHe` 不上报 RotNum。仅 changmen 扩开展开时写入，供同 rot 拼未开图。
    ...(isPbChangmenExtensions() && row.rotNum ? { RotNum: row.rotNum } : {}),
    IsLive: row.isLive ? 1 : 0,
  };
}

/** Report：parse 后的单场 → SaveBet 行 */
export function buildPbSaveBetRowsFromParsedMatch(row: PbParsedMatch): CollectBetDto[] {
  return buildPbSaveBetRowsFromMatch(row, PLATFORM) as CollectBetDto[];
}

/** Ingest fo + 返回 match / bets 载荷（collect 轮询用）
 * @param opts.writeFo 默认 true。`false` 时不写 fo，仍同步 lineId（A8 模式下 prematch 不跑）。
 */
export function ingestAndReportPbParsedMatch(
  row: PbParsedMatch,
  now = Date.now(),
  opts?: { writeFo?: boolean },
): { match: CollectMatchDto; bets: CollectBetDto[] } {
  if (isPbChangmenExtensions() && row.rotNum)
    rememberPbRotEvent(row.matchId, row.rotNum);
  if (isPbWsShadowUiAllowed())
    upsertPbWsShadowFromParsedMatch(row);
  if (opts?.writeFo !== false)
    ingestPbParsedMatchToFo(row, now);
  else
    syncPbLineIdsFromParsedMatch(row);
  return {
    match: buildPbCollectMatchDto(row),
    bets: buildPbSaveBetRowsFromParsedMatch(row),
  };
}

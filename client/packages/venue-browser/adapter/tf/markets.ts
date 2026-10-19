import { saveVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import { directGet } from "@changmen/client-core/shared/http";
import { tfRequestHeaders } from "./auth";
import type { CollectBetDto, CollectMatchDto } from "@changmen/client-core/types/collect";
import type { CollectPlatformInfo } from "@changmen/api-contract";
import { PLATFORMS } from "../shared/platforms";
import { wait } from "@changmen/client-core/shared/wait";
import { useCollectStore } from "../shared/webBridge";

import {
  buildTfSaveBetRowsFromResults,
  extractMapTabsFromResults,
  listTfMarketFoEntries,
  isTfMarketCollectable,
  stageFromTabName,
  type TfStageMeta,
} from "./shared/save_bets";

const PLATFORM = PLATFORMS.TF;
export const TF_STAGE_WAIT_MS = 1000;

function parseBo(raw: unknown): number {
  const m = String(raw ?? "").match(/BO(\d+)/i);
  return m ? Number(m[1]) || 0 : 0;
}

function parseTfStartTimeMs(raw: unknown): number {
  if (!raw) return 0;
  const ms = Date.parse(String(raw).replace(" ", "T"));
  return Number.isNaN(ms) ? 0 : ms;
}

/** A8 `h4e`：浏览器直连 TF /api/v8/events/ */
export async function collectTfGet<T>(
  platform: CollectPlatformInfo,
  query: Record<string, string>,
): Promise<T> {
  if (!platform.Gateway || !platform.Token) {
    throw new Error("TF collect platform not configured");
  }
  const base = platform.Gateway.replace(/\/+$/, "");
  const qs = new URLSearchParams({
    combo: "false",
    outright: "false",
    lang: "zh",
    timezone: "Asia/Shanghai",
    ...query,
  });
  const url = `${base}/api/v8/events/?${qs}`;
  const headers = await tfRequestHeaders(platform.Token);
  return directGet<T>(url, headers);
}

export function buildTfCollectMatchDto(row: Record<string, unknown>): CollectMatchDto | null {
  const home = row.home as Record<string, unknown> | undefined;
  const away = row.away as Record<string, unknown> | undefined;
  if (!home || !away) return null;

  return {
    Type: PLATFORM,
    SourceMatchID: row.event_id as string | number,
    SourceGameID: row.game_id as string | number,
    BO: parseBo(row.best_of),
    StartTime: parseTfStartTimeMs(row.start_datetime),
    Home: String(home.team_name ?? ""),
    HomeID: String(home.team_id ?? ""),
    Away: String(away.team_name ?? ""),
    AwayID: String(away.team_id ?? ""),
    Teams: [
      {
        Type: PLATFORM,
        GameID: row.game_id as string | number,
        Name: String(home.team_name ?? ""),
        TeamID: String(home.team_id ?? ""),
        Logo: "",
      },
      {
        Type: PLATFORM,
        GameID: row.game_id as string | number,
        Name: String(away.team_name ?? ""),
        TeamID: String(away.team_id ?? ""),
        Logo: "",
      },
    ],
  };
}

/** Ingest：HTTP results → fo */
function ingestTfResultsToFo(
  results: Array<Record<string, unknown>>,
  betRe: RegExp,
  now = Date.now(),
): void {
  for (const block of results) {
    for (const market of (block.markets ?? []) as Array<Record<string, unknown>>) {
      if (!isTfMarketCollectable(market, betRe)) continue;
      for (const entry of listTfMarketFoEntries(market)) {
        saveVenueOdds(PLATFORM, { ...entry, time: now });
      }
    }
  }
}

function ingestAndReportTfResults(
  results: Array<Record<string, unknown>>,
  matchId: string,
  teamNames: [string, string],
  betRe: RegExp,
  stageMeta: TfStageMeta,
  now = Date.now(),
): CollectBetDto[] {
  ingestTfResultsToFo(results, betRe, now);
  return buildTfSaveBetRowsFromResults(
    results,
    matchId,
    teamNames,
    betRe,
    stageMeta,
    PLATFORM,
  ) as CollectBetDto[];
}

/** 单场详情：Ingest fo + Report SaveBet 行 + 上报 API */
export async function loadTfBets(
  platform: CollectPlatformInfo,
  matchId: string,
  betRe: RegExp,
  teamNames: [string, string],
): Promise<CollectBetDto[]> {
  const byStage = new Map<number, CollectBetDto>();
  const mergeRows = (rows: CollectBetDto[]) => {
    for (const row of rows) byStage.set(row.Map, row);
  };

  await wait(TF_STAGE_WAIT_MS);
  const matchRes = await collectTfGet<{ results?: Array<Record<string, unknown>> }>(platform, {
    event_id: matchId,
    market_option: "MATCH",
  });
  const matchResults = matchRes.results ?? [];
  mergeRows(
    ingestAndReportTfResults(
      matchResults,
      matchId,
      teamNames,
      betRe,
      stageFromTabName("MATCH")!,
    ),
  );

  const mapTabs = extractMapTabsFromResults(matchResults);
  for (const tabName of mapTabs) {
    await wait(TF_STAGE_WAIT_MS);
    const meta = stageFromTabName(tabName);
    if (!meta || meta.marketOption !== "MAP") continue;
    const mapRes = await collectTfGet<{ results?: Array<Record<string, unknown>> }>(platform, {
      event_id: matchId,
      market_option: "MAP",
      map_option: meta.mapOption,
    });
    mergeRows(
      ingestAndReportTfResults(mapRes.results ?? [], matchId, teamNames, betRe, meta),
    );
  }

  const bets = [...byStage.values()].sort((a, b) => a.Map - b.Map);
  if (bets.length) {
    await useCollectStore().saveBets(PLATFORM, matchId, bets);
  }
  return bets;
}

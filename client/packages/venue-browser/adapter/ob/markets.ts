import { saveVenueOdds } from "@changmen/client-core/bridge/oddsAccess";

import { directGet } from "@changmen/client-core/shared/http";
import { num } from "./parse";
import type { CollectBetDto } from "@changmen/client-core/types/collect";
import type { ViewMatch } from "@changmen/client-core/models/match";
import type { CollectPlatformInfo } from "@changmen/api-contract";
import { PLATFORMS } from "../shared/platforms";
import { wait } from "@changmen/client-core/shared/wait";
import { useCollectStore } from "../shared/webBridge";

import {
  buildObSaveBetRowsFromViewBlocks,
  isObBlockCollectable,
  listObBlockFoOddEntries,
  obBlockLocked,
} from "./shared/save_bets";
import { obBlockLabel } from "./parse";

const PLATFORM = PLATFORMS.OB;
const STAGE_VIEW_INTERVAL_MS = 1500;

/** 轮询 game/index：与 backend stageIdsForBo 一致（BO1 仅全场） */
export function maxStageFromBo(bo: unknown): number {
  const n = num(bo);
  return n <= 1 ? 0 : n;
}

export function teamNamesFromViewMatch(match: ViewMatch): [string, string] {
  const row = match.bets[0];
  if (row?.homeName && row?.awayName) return [row.homeName, row.awayName];
  const parts = match.title.split(/\s+vs\s+/i);
  return [parts[0]?.trim() ?? "", parts[1]?.trim() ?? ""];
}

/** GetMatchs 已有盘口 round → game/view 的 stage_id 上限 */
export function maxStageFromViewMatch(match: ViewMatch): number {
  if (!match.bets.length) return 0;
  return Math.max(0, ...match.bets.map((b) => b.round));
}

/** 拉盘 stage 上限：不能只看当前 Bets（过滤组合盘后可能只剩全场） */
export function maxStageForObLoad(match: ViewMatch): number {
  const fromBets = maxStageFromViewMatch(match);
  const fromBo = match.bo != null && match.bo > 0 ? maxStageFromBo(match.bo) : 0;
  return Math.max(fromBets, fromBo);
}

/** Ingest：可采集 block 写入 fo（不含 API 回传） */
function ingestObViewBlocksToFo(
  blocks: Array<Record<string, unknown>>,
  betRe: RegExp,
  gameCode?: string | null,
): void {
  const now = Date.now();
  for (const block of blocks) {
    const label = obBlockLabel(block);
    if (!isObBlockCollectable(block, label, betRe, gameCode)) continue;
    const locked = obBlockLocked(block);
    for (const entry of listObBlockFoOddEntries(block, locked)) {
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

/** Report：内存快照 → SaveBet 行（不含 fo / HTTP） */
function reportObViewBlocksToSaveBetRows(
  blocks: Array<Record<string, unknown>>,
  matchId: string,
  teamNames: [string, string],
  betRe: RegExp,
  gameCode?: string | null,
): CollectBetDto[] {
  return buildObSaveBetRowsFromViewBlocks(blocks, matchId, teamNames, betRe, gameCode, PLATFORM);
}

/** 单场各 stage 拉 game/view：Ingest fo + 返回 Report 载荷 */
export async function loadMarketsForMatch(
  platform: CollectPlatformInfo,
  matchId: string,
  maxStage: number,
  betRe: RegExp,
  teamNames: [string, string],
  gameCode?: string | null,
): Promise<{ bets: CollectBetDto[]; hadError: boolean }> {
  const bets: CollectBetDto[] = [];
  let hadError = false;
  for (let stage = 0; stage <= maxStage; stage += 1) {
    try {
      const view = await collectObGet<{ status: string; data?: Array<Record<string, unknown>> }>(
        platform,
        "game/view",
        `match_id=${matchId}&stage_id=${stage}`,
      );
      if (view.status !== "true" || !Array.isArray(view.data)) continue;

      ingestObViewBlocksToFo(view.data, betRe, gameCode);
      bets.push(...reportObViewBlocksToSaveBetRows(view.data, matchId, teamNames, betRe, gameCode));
    } catch (err) {
      hadError = true;
      console.error("[OB] game/view error", matchId, stage, err);
    } finally {
      await wait(STAGE_VIEW_INTERVAL_MS);
    }
  }

  return { bets, hadError };
}

/** 灌 fo + 落库（GetMatchs / 订阅刷新共用） */
export async function refreshObMatchMarkets(
  platform: CollectPlatformInfo,
  sourceMatchId: string,
  match: ViewMatch,
  betRe: RegExp,
): Promise<void> {
  const collect = useCollectStore();
  const loaded = await loadMarketsForMatch(
    platform,
    sourceMatchId,
    maxStageForObLoad(match),
    betRe,
    teamNamesFromViewMatch(match),
    match.game || null,
  );
  // [A8 可证实] UMe：h||saveBets — 仅 hadError 挡上报，空数组仍 saveBets
  if (!loaded.hadError) {
    await collect.saveBets(PLATFORM, sourceMatchId, loaded.bets);
  }
}

/** 对齐 A8 Ck(platform) */
function obHeaders(token: string): Record<string, string> {
  return { device: "1", lang: "cn", token, Accept: "application/json, text/plain, */*" };
}

/** A8 NMe：Rr.get(Nr) 直连 OB gateway */
export async function collectObGet<T>(
  platform: CollectPlatformInfo,
  path: string,
  query = "",
): Promise<T> {
  if (!platform.Gateway || !platform.Token) throw new Error("OB collect platform not configured");
  const base = platform.Gateway.replace(/\/+$/, "");
  const apiPath = path.startsWith("/") ? path : `/${path}`;
  const q = query ? (apiPath.includes("?") ? "&" : "?") + query : "";
  return directGet<T>(`${base}${apiPath}${q}`, obHeaders(platform.Token));
}

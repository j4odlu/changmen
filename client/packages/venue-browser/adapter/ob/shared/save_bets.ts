import type { CollectBetDto } from "@changmen/client-core/types/collect";
import type { PlatformId } from "@changmen/api-contract";
import { PLATFORMS } from "../../shared/platforms";
import {
  getDefaultMarketCode,
  getPlatformRules,
  obLegacyWinBetName,
  obMatchesOddTypeId,
} from "@changmen/shared/catalog/market_catalog.browser";
import { num, obBlockLabel, parseObOddField } from "./parse_fields";

let cachedPattern: string | undefined;
let cachedRe: RegExp | undefined;

/** 缓存 platform.BetName 对应正则，避免每�?new RegExp */
export function compileObBetNameRe(betName: string | undefined): RegExp {
  const pattern = betName || ".*";
  if (cachedPattern === pattern && cachedRe) {
    return cachedRe;
  }
  cachedPattern = pattern;
  cachedRe = new RegExp(pattern);
  return cachedRe;
}

export function obBlockLocked(block: Record<string, unknown>): boolean {
  return block.status !== 6 || block.visible !== 1 || block.suspended !== 0;
}

/**
 * A8 UMe：单 block 是否进入 saveBets / fo�? * catalog：优�?odd_type_id（命中则不再�?betName）；否则 platform BetName + obLegacyWinBetName�? */
export function isObBlockCollectable(
  block: Record<string, unknown>,
  label: string,
  betRe: RegExp,
  gameCode?: string | null,
): boolean {
  if (block.status === 12 || block.visible === 0) return false;

  const rules = getPlatformRules("OB", getDefaultMarketCode());
  const round = Number(block.round ?? 0);
  const oddTypeId = block.odd_type_id;

  if (gameCode && oddTypeId != null && String(oddTypeId) !== "") {
    const byId = obMatchesOddTypeId(block, rules, gameCode, round);
    if (byId === true) return true;
    if (byId === false) return false;
  }

  if (!betRe.test(label)) return false;
  return obLegacyWinBetName(label);
}

function findObMainOddsSides(entries: Array<Record<string, unknown>>): {
  home?: Record<string, unknown>;
  away?: Record<string, unknown>;
} {
  let home: Record<string, unknown> | undefined;
  let away: Record<string, unknown> | undefined;
  for (const p of entries) {
    if (p.name === "@T1") home = p;
    else if (p.name === "@T2") away = p;
    if (home && away) break;
  }
  return { home, away };
}

/** game/view �?block �?SaveBet 行；不可采集或缺主客赔率时返�?null */
export function obBlockToSaveBetRow(
  block: Record<string, unknown>,
  matchId: string,
  teamNames: [string, string],
  platform: PlatformId = PLATFORMS.OB,
): CollectBetDto | null {
  const oddsMap = (block.odds ?? {}) as Record<string, Record<string, unknown>>;
  const entries = Object.values(oddsMap);
  const { home, away } = findObMainOddsSides(entries);
  if (!home || !away) return null;

  const locked = obBlockLocked(block);
  const label = obBlockLabel(block);
  return {
    Type: platform,
    SourceMatchID: matchId,
    Map: num(block.round),
    SourceBetID: String(block.id),
    BetName: label,
    SourceHomeID: String(home.id),
    HomeName: teamNames[0] ?? "",
    HomeOdds: parseObOddField(home),
    SourceAwayID: String(away.id),
    AwayName: teamNames[1] ?? "",
    AwayOdds: parseObOddField(away),
    Status: locked ? "Locked" : "Normal",
  };
}

/** game/view data[] �?SaveBet 行（Report 层；�?fo 灌入使用同一�?isObBlockCollectable�?*/
export function buildObSaveBetRowsFromViewBlocks(
  blocks: Array<Record<string, unknown>>,
  matchId: string,
  teamNames: [string, string],
  betRe: RegExp,
  gameCode?: string | null,
  platform: PlatformId = PLATFORMS.OB,
): CollectBetDto[] {
  const bets: CollectBetDto[] = [];
  for (const block of blocks) {
    const label = obBlockLabel(block);
    if (!isObBlockCollectable(block, label, betRe, gameCode)) continue;
    const row = obBlockToSaveBetRow(block, matchId, teamNames, platform);
    if (row) bets.push(row);
  }
  return bets;
}

/** fo 灌入用的赔率条目（Ingest 层；不含 Pinia，由 markets 写入 oddsStore�?*/
export function listObBlockFoOddEntries(
  block: Record<string, unknown>,
  locked: boolean,
): Array<{
  id: string;
  odds: number;
  isLock: boolean;
  betId: string;
}> {
  const oddsMap = (block.odds ?? {}) as Record<string, Record<string, unknown>>;
  const betId = String(block.id);
  return Object.values(oddsMap).map((p) => ({
    id: String(p.id),
    odds: parseObOddField(p),
    isLock: locked,
    betId,
  }));
}

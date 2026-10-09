/**
 * Polymarket 电竞 discovery 一轮（官方对齐 + VPS 独占写库）。
 *
 * 官方入选（api.js）：closed=false + series keyset；主窗 start∈[now-6h,now+1h]；补 pass live；本地丢 ended。
 * 写库：采到就 upsert；prune 仅 ended/closed ∪ synced 过旧（窗只约束拉取，不按 start 删行）。
 * Index 与 DB 同生命周期：空窗不硬清空，只剔 ended。浏览器禁止 SaveMatch/SaveBet/SaveLiveTimer。
 *
 * - live（默认）：写 platform_* + MarketIndex
 * - shadow：POLYMARKET_COLLECTOR_WRITE_PLATFORM=0 → 只写 MarketIndex
 * - Gamma/网络抛错 → 上层 catch，本函数不写空库
 * - 有 typed ML 但解析全失败 → skipWrite，保留旧 RDS
 */

import {
  prunePolymarketPlatformMatches,
  replacePlatformBetsForMatchAsync,
  writePlatformMatchesAsync,
} from "@changmen/db";
import { formatBetOdds } from "@changmen/shared/odds_format";

import {
  fetchBatchBuyPrices,
  fetchPolymarketEsportsMarkets,
  fetchPolymarketOfficialMarkets,
  normalizeSportsMarketType,
  polymarketCollectStartTimeAllowed,
  resolveCollectMarketTypes,
  takeWholeMatchesUpTo,
} from "./api.js";
import { persistPolymarketMarketIndex } from "./market_index.js";
import {
  buildPolymarketMappedMarket,
  parseJsonArray,
} from "./parse.js";

const PLATFORM = "Polymarket";
const MAX_TRACKED_MARKETS = 400;

/** live 写库：默认 true；shadow 设 POLYMARKET_COLLECTOR_WRITE_PLATFORM=0 */
export function isPolymarketCollectorPlatformWriteEnabled() {
  const v = String(process.env.POLYMARKET_COLLECTOR_WRITE_PLATFORM ?? "1")
    .trim()
    .toLowerCase();
  return v !== "0" && v !== "false" && v !== "off" && v !== "no";
}

/**
 * @param {{
 *   fetchMarkets?: typeof fetchPolymarketEsportsMarkets,
 *   fetchPrices?: typeof fetchBatchBuyPrices,
 *   fetchOfficialMarkets?: typeof fetchPolymarketOfficialMarkets,
 *   resolveTypes?: typeof resolveCollectMarketTypes,
 *   writeMatches?: typeof writePlatformMatchesAsync,
 *   replaceBets?: typeof replacePlatformBetsForMatchAsync,
 *   persistIndex?: typeof persistPolymarketMarketIndex,
 *   pruneMatches?: typeof prunePolymarketPlatformMatches,
 *   writePlatform?: boolean,
 *   maxTracked?: number,
 *   nowMs?: number,
 * }} [deps]
 */
export async function runPolymarketEsportsDiscoveryCycle(deps = {}) {
  const fetchMarkets = deps.fetchMarkets ?? fetchPolymarketEsportsMarkets;
  const fetchPrices = deps.fetchPrices ?? fetchBatchBuyPrices;
  const fetchOfficialMarkets = deps.fetchOfficialMarkets ?? fetchPolymarketOfficialMarkets;
  const resolveTypes = deps.resolveTypes ?? resolveCollectMarketTypes;
  const writeMatches = deps.writeMatches ?? writePlatformMatchesAsync;
  const replaceBets = deps.replaceBets ?? replacePlatformBetsForMatchAsync;
  const persistIndex = deps.persistIndex ?? persistPolymarketMarketIndex;
  const pruneMatches = deps.pruneMatches ?? prunePolymarketPlatformMatches;
  const writePlatform = deps.writePlatform ?? isPolymarketCollectorPlatformWriteEnabled();
  const maxTracked = deps.maxTracked ?? MAX_TRACKED_MARKETS;
  const nowMs = deps.nowMs ?? Date.now();

  const collectTypes = await resolveTypes();
  const {
    markets: rawMarkets,
    rawEventCount,
    rawMarketCount,
    excludeSourceMatchIds: excludeSourceMatchIdsRaw,
  } = await fetchMarkets();
  const excludeSourceMatchIds = [...new Set(
    (excludeSourceMatchIdsRaw || []).map(String).filter(Boolean),
  )];

  const typedMlRaw = [];
  for (const raw of rawMarkets) {
    const mtype = normalizeSportsMarketType(raw);
    if (!collectTypes.has(mtype))
      continue;
    const assetIds = parseJsonArray(raw.clob_token_ids ?? raw.clobTokenIds);
    if (assetIds.length !== 2)
      continue;
    typedMlRaw.push(raw);
  }

  const filtered = [];
  for (const raw of typedMlRaw) {
    const initial = buildPolymarketMappedMarket(raw, {}, { includeClosed: true });
    if (!initial)
      continue;
    if (!polymarketCollectStartTimeAllowed(initial.match.StartTime))
      continue;
    filtered.push(raw);
  }

  const tracked = takeWholeMatchesUpTo(
    filtered,
    raw => String(raw.events?.[0]?.id ?? raw.events?.[0]?.slug ?? raw.condition_id ?? raw.conditionId ?? raw.market ?? raw.id),
    maxTracked,
  );
  const officialMarkets = await fetchOfficialMarkets(tracked);
  const allAssetIds = officialMarkets.filter(raw => !raw.closed && !raw.archived).flatMap(raw =>
    parseJsonArray(raw.clob_token_ids ?? raw.clobTokenIds));
  const buyPrices = await fetchPrices(allAssetIds);

  /** @type {ReturnType<typeof buildPolymarketMappedMarket>[]} */
  const mappedAll = [];
  for (const raw of officialMarkets) {
    const mapped = buildPolymarketMappedMarket(raw, buyPrices);
    if (mapped)
      mappedAll.push(mapped);
  }

  const candidates = takeWholeMatchesUpTo(
    mappedAll,
    row => String(row.match.SourceMatchID),
    maxTracked,
  );

  // 双保险：本轮已写入的场绝不强删（防两 pass ended 抖动导致「先写后删」同轮自毁）
  const candidateSids = new Set(candidates.map(row => String(row.match.SourceMatchID)));
  const pruneOpts = {
    forceDeleteIds: excludeSourceMatchIds.filter(id => !candidateSids.has(String(id))),
    staleBeforeMs: nowMs - 48 * 3600 * 1000,
  };

  if (!candidates.length) {
    if (typedMlRaw.length > 0) {
      console.warn(
        `[polymarket-esports] skip write: typedMl=${typedMlRaw.length} filtered=0 `
        + `(rawMarkets=${rawMarketCount} events=${rawEventCount}); keep previous platform_*`,
      );
      return {
        matches: 0,
        bets: 0,
        skipped: true,
        reason: "filter_empty_with_typed_ml",
        writePlatform,
        rawMarketCount,
        rawEventCount,
        typedMlCount: typedMlRaw.length,
        collectTypes: [...collectTypes],
      };
    }

    // 官方窗内无 ML：不写空快照；prune ended∪stale；Index 剔 ended，不硬清空
    let deletedIds = [];
    if (writePlatform)
      deletedIds = await pruneMatches(pruneOpts);
    const removeIds = [...new Set([
      ...excludeSourceMatchIds,
      ...(Array.isArray(deletedIds) ? deletedIds.map(String) : []),
    ])];
    persistIndex([], {}, { removeSourceMatchIds: removeIds });
    const pruned = Array.isArray(deletedIds) ? deletedIds.length : Number(deletedIds) || 0;
    return {
      matches: 0,
      bets: 0,
      skipped: false,
      pruned,
      shadow: !writePlatform,
      writePlatform,
      rawMarketCount,
      rawEventCount,
      typedMlCount: 0,
      collectTypes: [...collectTypes],
    };
  }

  const matchMap = new Map(
    candidates.map(row => [String(row.match.SourceMatchID), row.match]),
  );
  const betsByMatch = new Map();
  for (const mapped of candidates) {
    const sid = String(mapped.match.SourceMatchID);
    if (!betsByMatch.has(sid))
      betsByMatch.set(sid, []);
    betsByMatch.get(sid).push(formatBetOdds(mapped.bet));
  }

  const matches = [...matchMap.values()];

  let deletedIds = [];
  if (writePlatform) {
    await writeMatches(PLATFORM, matches);
    for (const [sid, bets] of betsByMatch)
      await replaceBets(PLATFORM, sid, bets);
    deletedIds = await pruneMatches(pruneOpts);
  }
  const removeIds = [...new Set([
    ...excludeSourceMatchIds,
    ...(Array.isArray(deletedIds) ? deletedIds.map(String) : []),
  ])];
  persistIndex(candidates, buyPrices, { removeSourceMatchIds: removeIds });
  const pruned = Array.isArray(deletedIds) ? deletedIds.length : Number(deletedIds) || 0;

  return {
    matches: matches.length,
    bets: [...betsByMatch.values()].reduce((n, b) => n + b.length, 0),
    skipped: false,
    pruned,
    shadow: !writePlatform,
    writePlatform,
    rawMarketCount,
    rawEventCount,
    collectTypes: [...collectTypes],
  };
}

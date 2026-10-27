import { writePredictFunMarketIndex } from "@changmen/storage/predictfun_market_index";
import {
  bestAskFromPredictBook,
  predictBuyAskFromYesBook,
} from "./parse.js";

/** @param {import("@changmen/api-contract").PredictFunMarketIndexEntry[]} entries */
export function buildPredictFunMarketIndexFromMapped(entries) {
  const marketIdSet = new Set();
  for (const row of entries) {
    if (row.homeMarketId)
      marketIdSet.add(row.homeMarketId);
    if (row.awayMarketId)
      marketIdSet.add(row.awayMarketId);
  }
  return {
    updatedAt: Date.now(),
    marketIds: [...marketIdSet],
    entries,
  };
}

/**
 * @param {ReturnType<import("./parse.js").buildPredictMappedMarket>[]} candidates
 * @param {Record<string, { asks?: unknown[], bids?: unknown[] }>} [books]
 * @returns {import("@changmen/api-contract").PredictFunMarketIndex}
 */
export function buildPredictFunMarketIndexPayload(candidates, books = {}) {
  const marketIdSet = new Set();
  const entries = [];
  for (const mapped of candidates) {
    for (const id of mapped.marketIds || []) {
      if (id)
        marketIdSet.add(String(id));
    }
    if (mapped.homeMarketId)
      marketIdSet.add(String(mapped.homeMarketId));
    if (mapped.awayMarketId)
      marketIdSet.add(String(mapped.awayMarketId));
    const list = Array.isArray(mapped.bets) && mapped.bets.length
      ? mapped.bets
      : [mapped.bet];
    const bookMeta = mapped.bookMetaByMarketId || {};
    for (const bet of list) {
      const betMarketId = String(bet.MarketID || "").trim();
      // 局盘/单盘：MarketID 有值 → 主客同盘；双盘旧形态：无 MarketID → 用 mapped 两侧 marketId
      const homeMarketId = betMarketId || String(mapped.homeMarketId || "");
      const awayMarketId = betMarketId || String(mapped.awayMarketId || homeMarketId);
      const homeTokenId = String(bet.SourceHomeID || mapped.homeTokenId);
      const awayTokenId = String(bet.SourceAwayID || mapped.awayTokenId);
      const meta = bookMeta[homeMarketId] || bookMeta[betMarketId] || {};
      const yesTokenId = String(meta.yesTokenId || "").trim();
      const precision = Number.isFinite(meta.decimalPrecision)
        ? Number(meta.decimalPrecision)
        : 2;

      let homeClob;
      let awayClob;
      if (homeMarketId && awayMarketId && homeMarketId === awayMarketId) {
        const book = books[homeMarketId];
        // 无 yesTokenId 时不猜测主客谁是 Yes，避免种子写反
        if (book && yesTokenId) {
          homeClob = predictBuyAskFromYesBook(book, homeTokenId === yesTokenId, precision);
          awayClob = predictBuyAskFromYesBook(book, awayTokenId === yesTokenId, precision);
        }
      }
      else {
        const homeBook = books[homeMarketId];
        const awayBook = books[awayMarketId];
        if (homeBook)
          homeClob = bestAskFromPredictBook(homeBook);
        if (awayBook)
          awayClob = bestAskFromPredictBook(awayBook);
      }

      /** @type {import("@changmen/api-contract").PredictFunMarketIndexEntry} */
      const entry = {
        sourceMatchId: String(mapped.match.SourceMatchID),
        categoryId: mapped.categoryId,
        homeMarketId,
        awayMarketId,
        homeTokenId,
        awayTokenId,
        sourceBetId: String(bet.SourceBetID),
        map: Number(bet.Map) || 0,
        homeName: bet.HomeName,
        awayName: bet.AwayName,
        homeOdds: Number(bet.HomeOdds) || 0,
        awayOdds: Number(bet.AwayOdds) || 0,
        status: String(bet.Status ?? "Locked"),
      };
      // 仅单盘双 outcome 需要 yesTokenId；双盘各吃各自 Yes，不写以免误导
      if (yesTokenId && homeMarketId === awayMarketId)
        entry.yesTokenId = yesTokenId;
      if (Number.isFinite(precision))
        entry.decimalPrecision = precision;
      if (Number.isFinite(homeClob) && homeClob > 0 && homeClob < 1)
        entry.homeClobPrice = homeClob;
      if (Number.isFinite(awayClob) && awayClob > 0 && awayClob < 1)
        entry.awayClobPrice = awayClob;

      entries.push(entry);
      if (homeMarketId)
        marketIdSet.add(homeMarketId);
      if (awayMarketId)
        marketIdSet.add(awayMarketId);
    }
  }
  return {
    updatedAt: Date.now(),
    marketIds: [...marketIdSet],
    entries,
  };
}

/**
 * @param {ReturnType<import("./parse.js").buildPredictMappedMarket>[]} candidates
 * @param {Record<string, { asks?: unknown[], bids?: unknown[] }>} [books]
 */
export function persistPredictFunMarketIndex(candidates, books = {}) {
  writePredictFunMarketIndex(buildPredictFunMarketIndexPayload(candidates, books));
}

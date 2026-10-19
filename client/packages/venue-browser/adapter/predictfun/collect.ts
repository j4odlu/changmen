/**
 * PredictFun 电竞：VPS 写 platform_* + MarketIndex；浏览器 Index → Market WS → fo。
 * 对齐 Polymarket collect：不跑 categories discovery；实时价只走 WS token quote；Index 变更时种子 clob。
 * **禁止**浏览器 SaveMatch/SaveBets（VPS collector 独占；浏览器上报会抹局盘）。
 */
import { getCollectPlatform } from "@changmen/client-core/bridge/clientApi";
import { saveVenueOdds, getVenueOddsEntry } from "@changmen/client-core/bridge/oddsAccess";
import type { CollectBetDto } from "@changmen/client-core/types/collect";
import type { PredictFunMarketIndexEntry } from "@changmen/api-contract";
import { PLATFORMS } from "../shared/platforms";
import { wait } from "@changmen/client-core/shared/wait";
import { notifyCollectError } from "../shared/collectNotify";
import { useMatchStore } from "../shared/webBridge";

import {
  applyPredictFunMarketIndex,
  isPredictFunMarketIndex,
} from "./marketIndex";
import {
  buildPredictFunBookMeta,
  decimalOddsFromProbability,
  type PredictFunBookMeta,
  type PredictMappedMarket,
} from "./parse";
import { isValidPredictClobPrice } from "./pfDetection";
import {
  clearPredictFunBookMetas,
  onPredictFunMarketHubReady,
  onPredictFunTokenQuote,
  registerPredictFunBookMetas,
  registerPredictFunQuoteMarkets,
  unregisterPredictFunQuoteConsumer,
} from "./marketQuoteHub";

const PLATFORM = PLATFORMS.PredictFun;
/** 对齐 PM：Index 只做发现/映射/种子，非刷价 */
const INDEX_SYNC_MS = 30_000;
const QUOTE_CONSUMER = "esport" as const;

type TokenBetRef = {
  betId: string;
  side: "home" | "away";
  marketId: string;
};

/** PF 写 fo 的唯一入口：decimal odds 供展示，clobPrice 供预检 */
export function saveTokenQuote(
  params: {
    tokenId: string;
    marketId: string;
    clobPrice: number;
    betId: string;
    side: "home" | "away";
    locked: boolean;
  },
  source: "http" | "mqtt",
) {
  saveVenueOdds(PLATFORM, {
    id: params.tokenId,
    odds: decimalOddsFromProbability(params.clobPrice),
    clobPrice: params.clobPrice,
    marketId: params.marketId,
    isLock: params.locked,
    betId: params.betId,
    side: params.side,
    time: Date.now(),
  }, source);
}

function saveBetOddsToFo(
  bet: CollectBetDto,
  source: "http" | "mqtt",
  marketIds: { home: string; away: string },
  clobPrices?: { home?: number; away?: number },
) {
  const locked = bet.Status === "Locked";
  const betId = String(bet.SourceBetID);
  const homeId = String(bet.SourceHomeID);
  const awayId = String(bet.SourceAwayID);
  const homePrice = clobPrices?.home;
  // Index 种子：若该 token 已有 WS(mqtt) 价，勿用慢 Index 盖掉
  if (Number.isFinite(homePrice) && isValidPredictClobPrice(homePrice!)) {
    const prev = source === "http" ? getVenueOddsEntry(PLATFORM, homeId) : null;
    if (!(prev?.source === "mqtt" && isValidPredictClobPrice(Number(prev.clobPrice)))) {
      saveTokenQuote({
        tokenId: homeId,
        marketId: marketIds.home,
        clobPrice: homePrice!,
        betId,
        side: "home",
        locked: locked || !bet.HomeOdds,
      }, source);
    }
  }
  const awayPrice = clobPrices?.away;
  if (Number.isFinite(awayPrice) && isValidPredictClobPrice(awayPrice!)) {
    const prev = source === "http" ? getVenueOddsEntry(PLATFORM, awayId) : null;
    if (!(prev?.source === "mqtt" && isValidPredictClobPrice(Number(prev.clobPrice)))) {
      saveTokenQuote({
        tokenId: awayId,
        marketId: marketIds.away,
        clobPrice: awayPrice!,
        betId,
        side: "away",
        locked: locked || !bet.AwayOdds,
      }, source);
    }
  }
}

function bookMetasFromIndexEntries(
  entries: PredictFunMarketIndexEntry[],
): Map<string, PredictFunBookMeta> {
  const out = new Map<string, PredictFunBookMeta>();
  for (const entry of entries) {
    const homeMid = String(entry.homeMarketId || "").trim();
    const awayMid = String(entry.awayMarketId || homeMid).trim();
    const homeTok = String(entry.homeTokenId || "").trim();
    const awayTok = String(entry.awayTokenId || "").trim();
    const precision = entry.decimalPrecision;
    if (homeMid && awayMid && homeMid === awayMid) {
      out.set(homeMid, buildPredictFunBookMeta({
        homeTokenId: homeTok,
        awayTokenId: awayTok,
        yesTokenId: entry.yesTokenId,
        decimalPrecision: precision,
        dualOutcomeSameMarket: true,
      }));
      continue;
    }
    if (homeMid && homeTok) {
      out.set(homeMid, buildPredictFunBookMeta({
        homeTokenId: homeTok,
        awayTokenId: awayTok,
        decimalPrecision: precision,
        dualOutcomeSameMarket: false,
        sideTokenId: homeTok,
      }));
    }
    if (awayMid && awayTok && awayMid !== homeMid) {
      out.set(awayMid, buildPredictFunBookMeta({
        homeTokenId: homeTok,
        awayTokenId: awayTok,
        decimalPrecision: precision,
        dualOutcomeSameMarket: false,
        sideTokenId: awayTok,
      }));
    }
  }
  return out;
}

function rebuildTokenBetIndex(
  marketsByCategory: Map<string, PredictMappedMarket>,
  tokenToBet: Map<string, TokenBetRef>,
): void {
  tokenToBet.clear();
  for (const mapped of marketsByCategory.values()) {
    const bets = Array.isArray(mapped.bets) && mapped.bets.length
      ? mapped.bets
      : [mapped.bet];
    const sameMarket = String(mapped.homeMarketId || "") === String(mapped.awayMarketId || "");
    for (const bet of bets) {
      const betId = String(bet.SourceBetID || "");
      const homeId = String(bet.SourceHomeID || "");
      const awayId = String(bet.SourceAwayID || "");
      const betMarketId = String((bet as { MarketID?: string }).MarketID || "").trim();
      const homeMarketId = betMarketId || String(mapped.homeMarketId || "");
      const awayMarketId = betMarketId
        || (sameMarket ? homeMarketId : String(mapped.awayMarketId || mapped.homeMarketId || ""));
      if (homeId && betId) {
        tokenToBet.set(homeId, {
          betId,
          side: "home",
          marketId: homeMarketId,
        });
      }
      if (awayId && betId) {
        tokenToBet.set(awayId, {
          betId,
          side: "away",
          marketId: awayMarketId,
        });
      }
    }
  }
}

/** [changmen 扩展] VPS HTTP 采集 + 浏览器行情 hub → fo（不经 http-relay 打 discovery） */
export function startPredictFunCollector(): () => void {
  const matchStore = useMatchStore();
  const marketsByCategory = new Map<string, PredictMappedMarket>();
  const marketIdToCategory = new Map<string, string>();
  const tokenToBet = new Map<string, TokenBetRef>();
  let lastIndexUpdatedAt = 0;
  let stopped = false;

  function esportMarketIds(): string[] {
    const ids: string[] = [];
    for (const mapped of marketsByCategory.values()) {
      for (const id of mapped.marketIds || [])
        ids.push(String(id));
      ids.push(mapped.homeMarketId, mapped.awayMarketId);
      for (const bet of mapped.bets || []) {
        const mid = String((bet as { MarketID?: string }).MarketID || "");
        if (mid)
          ids.push(mid);
      }
    }
    return [...new Set(ids.filter(Boolean))];
  }

  function syncEsportMarkets(force = false) {
    if (stopped)
      return;
    registerPredictFunQuoteMarkets(QUOTE_CONSUMER, esportMarketIds(), force);
  }

  function updateBetFromToken(tokenId: string, bestAsk: number) {
    const ref = tokenToBet.get(tokenId);
    if (!ref)
      return;
    if (!Number.isFinite(bestAsk) || bestAsk <= 0 || bestAsk >= 1)
      return;
    saveTokenQuote({
      tokenId,
      marketId: ref.marketId,
      clobPrice: bestAsk,
      betId: ref.betId,
      side: ref.side,
      locked: false,
    }, "mqtt");
  }

  const unQuote = onPredictFunTokenQuote((q) => {
    if (stopped)
      return;
    updateBetFromToken(q.tokenId, q.bestAsk);
  });

  const unReady = onPredictFunMarketHubReady(() => {
    syncEsportMarkets(true);
  });

  syncEsportMarkets();

  async function syncMarketIndex() {
    const platform = await getCollectPlatform(PLATFORM);
    const index = isPredictFunMarketIndex(platform?.MarketIndex) ? platform.MarketIndex : null;
    if (!index?.entries?.length) {
      if (lastIndexUpdatedAt !== 0) {
        marketsByCategory.clear();
        marketIdToCategory.clear();
        tokenToBet.clear();
        clearPredictFunBookMetas();
        lastIndexUpdatedAt = 0;
      }
      syncEsportMarkets();
      return;
    }
    if (index.updatedAt === lastIndexUpdatedAt)
      return;
    lastIndexUpdatedAt = index.updatedAt;

    applyPredictFunMarketIndex(index, {
      marketsByCategory,
      marketIdToCategory,
    });
    rebuildTokenBetIndex(marketsByCategory, tokenToBet);
    registerPredictFunBookMetas(bookMetasFromIndexEntries(index.entries));

    // 仅 Index 变更时用 clob 种子；无 clob 不灌价，避免 HTTP 盖掉 WS 实时 fo
    for (const entry of index.entries) {
      const mapped = marketsByCategory.get(String(entry.categoryId));
      if (!mapped)
        continue;
      const bets = Array.isArray(mapped.bets) && mapped.bets.length
        ? mapped.bets
        : [mapped.bet];
      const bet = bets.find(b => String(b.SourceBetID) === String(entry.sourceBetId))
        || bets.find(b => Number(b.Map) === (Number(entry.map) || 0))
        || mapped.bet;
      const homeMid = String(entry.homeMarketId || (bet as { MarketID?: string }).MarketID || mapped.homeMarketId);
      const awayMid = String(entry.awayMarketId || homeMid);
      const homeClob = Number(entry.homeClobPrice);
      const awayClob = Number(entry.awayClobPrice);
      const hasHomeClob = isValidPredictClobPrice(homeClob);
      const hasAwayClob = isValidPredictClobPrice(awayClob);
      if (!hasHomeClob && !hasAwayClob)
        continue;
      saveBetOddsToFo(bet, "http", {
        home: homeMid,
        away: awayMid,
      }, {
        ...(hasHomeClob ? { home: homeClob } : {}),
        ...(hasAwayClob ? { away: awayClob } : {}),
      });
    }
    matchStore.refreshOddsOnBets();
    // 集合变了才重订；同集短路。transport 重建靠 onPredictFunMarketHubReady(force)。
    syncEsportMarkets();
  }

  const loop = async () => {
    while (!stopped) {
      try {
        await syncMarketIndex();
      }
      catch (err) {
        console.warn("[PredictFun] index sync error", err);
        notifyCollectError("PredictFun", err);
      }
      await wait(INDEX_SYNC_MS);
    }
  };

  void loop();

  return () => {
    stopped = true;
    unQuote();
    unReady();
    unregisterPredictFunQuoteConsumer(QUOTE_CONSUMER);
  };
}

/**
 * Polymarket 电竞：VPS 写 platform_* + MarketIndex；浏览器只同步 Index → Market WS → fo。
 * 不再跑 Gamma / SaveMatch / SaveBets。
 */
import { getCollectPlatform } from "@changmen/client-core/bridge/clientApi";
import { saveVenueOdds, getVenueOddsEntry } from "@changmen/client-core/bridge/oddsAccess";
import type { CollectBetDto } from "@changmen/client-core/types/collect";
import type { PolymarketMarketIndex } from "@changmen/api-contract";
import { PLATFORMS } from "@changmen/client-core/shared/platforms";
import { wait } from "@changmen/client-core/shared/wait";
import { notifyCollectError } from "../../shared/collectNotify";
import { useCollectStore } from "../../shared/webBridge";
import { useMatchStore } from "../../shared/webBridge";

import {
  applyPolymarketMarketIndex,
  isPolymarketMarketIndex,
} from "./marketIndex";
import { replacePmMapOutcomesFromIndex } from "./pmMapOutcomeStore";
import {
  decimalOddsFromProbability,
  type PolymarketMappedMarket,
} from "./parse";
import { isValidClobPrice } from "../submission/preflight/pmDetection";
import {
  onPolymarketMarketHubReady,
  onPolymarketMarketAskUnavailable,
  onPolymarketMarketQuote,
  registerPolymarketQuoteAssets,
  unregisterPolymarketQuoteConsumer,
} from "../marketQuoteHub";
import { recordPmQuoteToFoMetric } from "../pmExecutionMetrics";
import { saveTokenQuote } from "../quotes/pmTokenQuote";
import { getPmMarketWsSourceMode, onPmMarketWsSourceModeChange, type PmMarketWsSourceMode } from "../pmMarketWsMode";

export { saveTokenQuote } from "../quotes/pmTokenQuote";

const PLATFORM = PLATFORMS.Polymarket;
const INDEX_SYNC_MS = 30_000;
const QUOTE_CONSUMER = "esport" as const;

function saveBetOddsToFo(
  bet: CollectBetDto,
  source: "http" | "mqtt",
  clobPrices?: { home?: number; away?: number },
) {
  const betId = String(bet.SourceBetID);
  const homeId = String(bet.SourceHomeID);
  const awayId = String(bet.SourceAwayID);
  const homePrice = clobPrices?.home;
  // Index 种子：有 clob 的一侧按本侧可买解锁；勿用「对侧无价 → Status Locked」把本侧 fo 打成 isLock
  // （否则 getOdds 恒为 0，盘口空白，而 OrderList 仍可读 clobPrice）。对齐 PF：http 勿盖 mqtt。
  if (Number.isFinite(homePrice) && isValidClobPrice(homePrice!)) {
    const prev = source === "http" ? getVenueOddsEntry(PLATFORM, homeId) : null;
    if (!(prev?.source === "mqtt" && isValidClobPrice(Number(prev.clobPrice)))) {
      saveTokenQuote({
        tokenId: homeId,
        clobPrice: homePrice!,
        betId,
        side: "home",
        locked: false,
      }, source);
    }
  }
  else {
    const prev = getVenueOddsEntry(PLATFORM, homeId);
    if (!(source === "http" && prev?.source === "mqtt" && isValidClobPrice(Number(prev.clobPrice)))) {
      saveVenueOdds(PLATFORM, {
        id: homeId,
        odds: bet.HomeOdds,
        pmQuoteSource: "http-seed",
        ...(prev?.clobPrice != null && isValidClobPrice(prev.clobPrice) ? { clobPrice: prev.clobPrice } : {}),
        isLock: !bet.HomeOdds,
        betId,
        side: "home",
        time: Date.now(),
      }, source);
    }
  }
  const awayPrice = clobPrices?.away;
  if (Number.isFinite(awayPrice) && isValidClobPrice(awayPrice!)) {
    const prev = source === "http" ? getVenueOddsEntry(PLATFORM, awayId) : null;
    if (!(prev?.source === "mqtt" && isValidClobPrice(Number(prev.clobPrice)))) {
      saveTokenQuote({
        tokenId: awayId,
        clobPrice: awayPrice!,
        betId,
        side: "away",
        locked: false,
      }, source);
    }
  }
  else {
    const prev = getVenueOddsEntry(PLATFORM, awayId);
    if (!(source === "http" && prev?.source === "mqtt" && isValidClobPrice(Number(prev.clobPrice)))) {
      saveVenueOdds(PLATFORM, {
        id: awayId,
        odds: bet.AwayOdds,
        pmQuoteSource: "http-seed",
        ...(prev?.clobPrice != null && isValidClobPrice(prev.clobPrice) ? { clobPrice: prev.clobPrice } : {}),
        isLock: !bet.AwayOdds,
        betId,
        side: "away",
        time: Date.now(),
      }, source);
    }
  }
}

/**
 * 电竞行情消费者：同步 VPS MarketIndex，登记 asset，收到行情后写 fo。
 * 停采集只 unregister(esport)，不卸体育会话。
 *
 * Quote 只写 fo，不调 refreshOddsOnBets（对齐 A8 MQTT→Qn.save；全表同步由主循环 ~100ms
 * + 下单前 prepareArbAttempt 的 updateOdds；展示读 oddsStore）。
 * 官方直连只取 Index 映射；转发保留原种子初始化和 refresh。
 */
export function startPolymarketCollector(): () => void {
  const collect = useCollectStore();
  const matchStore = useMatchStore();
  const marketsById = new Map<string, PolymarketMappedMarket>();
  const assetToMarket = new Map<string, string>();
  let lastIndexUpdatedAt = 0;
  let lastIndexSourceMode: PmMarketWsSourceMode | undefined;
  let latestIndex: PolymarketMarketIndex | null = null;
  let stopped = false;

  function esportAssetIds(): string[] {
    const ids: string[] = [];
    for (const market of marketsById.values())
      ids.push(...market.assetIds);
    return ids;
  }

  function syncEsportAssets(force = false) {
    if (stopped)
      return;
    registerPolymarketQuoteAssets(QUOTE_CONSUMER, esportAssetIds(), force);
  }

  function updateBetFromAsset(assetId: string, bestAsk: string | number | undefined) {
    const marketId = assetToMarket.get(assetId);
    if (!marketId) {
      recordPmQuoteToFoMetric({
        tokenId: assetId,
        quotePrice: Number(bestAsk),
        quoteSource: "ws",
        success: false,
        rejectReason: "missing_mapping",
      });
      return;
    }
    const mapped = marketsById.get(marketId);
    if (!mapped) {
      recordPmQuoteToFoMetric({
        tokenId: assetId,
        quotePrice: Number(bestAsk),
        quoteSource: "ws",
        success: false,
        rejectReason: "missing_market",
      });
      return;
    }

    const price = Number(bestAsk);
    // 0 只由显式空卖盘通知传入：锁定本侧并清掉旧价格，而非继续展示旧卖一。
    if (!Number.isFinite(price) || price < 0 || price >= 1) {
      recordPmQuoteToFoMetric({
        tokenId: assetId,
        quotePrice: price,
        quoteSource: "ws",
        success: false,
        rejectReason: "invalid_price",
      });
      return;
    }

    const next: CollectBetDto = { ...mapped.bet };
    const decimalOdds = decimalOddsFromProbability(price);
    if (price > 0 && !(decimalOdds > 0)) {
      recordPmQuoteToFoMetric({
        tokenId: assetId,
        quotePrice: price,
        quoteSource: "ws",
        success: false,
        rejectReason: "invalid_decimal_odds",
      });
      return;
    }
    if (assetId === String(next.SourceHomeID))
      next.HomeOdds = decimalOdds;
    if (assetId === String(next.SourceAwayID))
      next.AwayOdds = decimalOdds;
    // mapped.bet 仍跟踪双边，供内部状态；fo 锁盘只看本侧是否有有效 ask（对齐 PF）
    next.Status = next.HomeOdds > 0 && next.AwayOdds > 0 ? "Normal" : "Locked";
    mapped.bet = next;
    const betId = String(next.SourceBetID);
    const side = assetId === String(next.SourceHomeID) ? "home" as const : "away" as const;
    saveTokenQuote({
      tokenId: assetId,
      clobPrice: price,
      betId,
      side,
      locked: price === 0,
    }, "mqtt", "ws");
  }

  const unQuote = onPolymarketMarketQuote((q) => {
    if (stopped)
      return;
    updateBetFromAsset(q.assetId, q.bestAsk);
  });
  const unUnavailable = onPolymarketMarketAskUnavailable((assetId) => {
    if (!stopped)
      updateBetFromAsset(assetId, 0);
  });

  const unReady = onPolymarketMarketHubReady(() => {
    syncEsportAssets(true);
  });

  syncEsportAssets();

  async function syncMarketIndex() {
    while (!collect.ready) {
      if (stopped)
        return;
      await wait(500);
    }

    const platform = await getCollectPlatform(PLATFORM);
    if (stopped)
      return;
    latestIndex = isPolymarketMarketIndex(platform?.MarketIndex) ? platform.MarketIndex : null;
    applyMarketIndex(latestIndex);
  }

  function applyMarketIndex(index: PolymarketMarketIndex | null) {
    if (!index?.entries?.length) {
      // 空 Index：卸掉电竞 maps，避免幽灵 asset；勿在从未成功过时反复 clear
      if (lastIndexUpdatedAt !== 0 || index?.outcomeEntries?.length) {
        marketsById.clear();
        assetToMarket.clear();
        replacePmMapOutcomesFromIndex(index?.outcomeEntries?.length ? index : null);
        lastIndexUpdatedAt = index?.outcomeEntries?.length ? index.updatedAt : 0;
      }
      syncEsportAssets();
      return;
    }
    const sourceMode = getPmMarketWsSourceMode();
    if (index.updatedAt === lastIndexUpdatedAt && sourceMode === lastIndexSourceMode)
      return;
    lastIndexUpdatedAt = index.updatedAt;
    lastIndexSourceMode = sourceMode;

    const includePrices = sourceMode !== "official";
    applyPolymarketMarketIndex(index, { marketsById, assetToMarket }, { includePrices });
    replacePmMapOutcomesFromIndex(index);
    if (includePrices) {
      for (const entry of index.entries) {
        const mapped = marketsById.get(String(entry.marketId));
        if (!mapped)
          continue;
        saveBetOddsToFo(mapped.bet, "http", {
          home: entry.homeClobPrice,
          away: entry.awayClobPrice,
        });
      }
      matchStore.refreshOddsOnBets();
    }
    // 集合变了才重订；同集短路。transport 重建靠 onPolymarketMarketHubReady(force)。
    syncEsportAssets();
  }

  const unSourceMode = onPmMarketWsSourceModeChange(() => {
    // 切源立即复用已取回的目录；不新增 HTTP 请求，也不能被同版本短路挡住。
    if (!stopped && latestIndex)
      applyMarketIndex(latestIndex);
  });

  const loop = async () => {
    while (!stopped) {
      try {
        await syncMarketIndex();
      }
      catch (err) {
        console.warn("[Polymarket] index sync error", err);
        notifyCollectError("Polymarket", err);
      }
      await wait(INDEX_SYNC_MS);
    }
  };

  void loop();

  return () => {
    stopped = true;
    unQuote();
    unUnavailable();
    unSourceMode();
    unReady();
    unregisterPolymarketQuoteConsumer(QUOTE_CONSUMER);
  };
}

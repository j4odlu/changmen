import { saveVenueOdds, getVenueOddsEntry } from "@changmen/client-core/bridge/oddsAccess";
import type { CollectBetDto } from "@changmen/client-core/types/collect";
import { hasA8PluginRuntime } from "@changmen/client-core/chrome-plugin/bridge";
import { PLATFORMS } from "../shared/platforms";
import { wait } from "@changmen/client-core/shared/wait";
import { notifyCollectError } from "../shared/collectNotify";
import { useCollectStore } from "../shared/webBridge";
import { useMatchStore } from "../shared/webBridge";

import {
  fetchLimitlessEsportsGroups,
  fetchLimitlessOrderbook,
  limitlessCollectStartTimeAllowed,
} from "./api";
import {
  bestAskFromBook,
  buildLimitlessMappedMarket,
  decimalOddsFromProbability,
  isLimitlessEsportsMatchWinnerGroup,
  type LimitlessMappedMarket,
} from "./parse";
import { LIMITLESS_PLUGIN_REQUIRED_MSG } from "./transport";
import { startLimitlessMarketWs } from "./ws";

const PLATFORM = PLATFORMS.Limitless;
const DISCOVERY_MS = 60_000;
const SAVE_BETS_INTERVAL_MS = 5 * 60_000;
const MAX_TRACKED_MARKETS = 200;
const ORDERBOOK_CONCURRENCY = 8;

export function saveTokenQuote(
  params: {
    tokenId: string;
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
    isLock: params.locked,
    betId: params.betId,
    side: params.side,
    time: Date.now(),
  }, source);
}

function saveBetOddsToFo(
  bet: CollectBetDto,
  source: "http" | "mqtt",
  clobPrices?: { home?: number; away?: number },
) {
  const locked = bet.Status === "Locked";
  const betId = String(bet.SourceBetID);
  const homeId = String(bet.SourceHomeID);
  const awayId = String(bet.SourceAwayID);
  const homePrice = clobPrices?.home;
  if (Number.isFinite(homePrice) && homePrice! > 0) {
    saveTokenQuote({
      tokenId: homeId,
      clobPrice: homePrice!,
      betId,
      side: "home",
      locked: locked || !bet.HomeOdds,
    }, source);
  }
  else {
    const prev = getVenueOddsEntry(PLATFORM, homeId);
    saveVenueOdds(PLATFORM, {
      id: homeId,
      odds: bet.HomeOdds,
      ...(prev?.clobPrice != null ? { clobPrice: prev.clobPrice } : {}),
      isLock: locked || !bet.HomeOdds,
      betId,
      side: "home",
      time: Date.now(),
    }, source);
  }
  const awayPrice = clobPrices?.away;
  if (Number.isFinite(awayPrice) && awayPrice! > 0) {
    saveTokenQuote({
      tokenId: awayId,
      clobPrice: awayPrice!,
      betId,
      side: "away",
      locked: locked || !bet.AwayOdds,
    }, source);
  }
  else {
    const prev = getVenueOddsEntry(PLATFORM, awayId);
    saveVenueOdds(PLATFORM, {
      id: awayId,
      odds: bet.AwayOdds,
      ...(prev?.clobPrice != null ? { clobPrice: prev.clobPrice } : {}),
      isLock: locked || !bet.AwayOdds,
      betId,
      side: "away",
      time: Date.now(),
    }, source);
  }
}

async function fetchBuyPricesForSlugs(slugs: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(slugs.filter(Boolean))];
  const prices: Record<string, number> = {};
  for (let i = 0; i < unique.length; i += ORDERBOOK_CONCURRENCY) {
    const chunk = unique.slice(i, i + ORDERBOOK_CONCURRENCY);
    const rows = await Promise.all(chunk.map(async (slug) => {
      const book = await fetchLimitlessOrderbook(slug);
      const ask = bestAskFromBook(book ?? undefined);
      return { slug, ask };
    }));
    for (const row of rows) {
      if (row.ask > 0 && row.ask < 1)
        prices[row.slug] = row.ask;
    }
  }
  return prices;
}

export function startLimitlessCollector(): () => void {
  let lastSaveBetsAt = 0;
  const collect = useCollectStore();
  const matchStore = useMatchStore();
  const marketsById = new Map<string, LimitlessMappedMarket>();
  const slugToMarket = new Map<string, string>();
  let pluginMissingNotified = false;

  function trackedSlugs(): string[] {
    const slugs: string[] = [];
    for (const mapped of marketsById.values()) {
      slugs.push(mapped.homeSlug, mapped.awaySlug);
    }
    return [...new Set(slugs)];
  }

  function updateBetFromSlug(slug: string, bestAsk: number) {
    const marketId = slugToMarket.get(slug);
    if (!marketId)
      return;
    const mapped = marketsById.get(marketId);
    if (!mapped)
      return;
    if (!Number.isFinite(bestAsk) || bestAsk <= 0 || bestAsk >= 1)
      return;

    const next: CollectBetDto = { ...mapped.bet };
    const tokenId = mapped.slugToTokenId[slug];
    const decimalOdds = decimalOddsFromProbability(bestAsk);
    if (tokenId === String(next.SourceHomeID))
      next.HomeOdds = decimalOdds;
    if (tokenId === String(next.SourceAwayID))
      next.AwayOdds = decimalOdds;
    next.Status = next.HomeOdds > 0 && next.AwayOdds > 0 ? "Normal" : "Locked";
    mapped.bet = next;

    const side = tokenId === String(next.SourceHomeID) ? "home" as const : "away" as const;
    // Quote 只写 fo；全表 refresh 交给主循环 / discovery 灌盘（对齐 PM / A8 MQTT）
    saveTokenQuote({
      tokenId,
      clobPrice: bestAsk,
      betId: String(next.SourceBetID),
      side,
      locked: next.Status === "Locked" || (side === "home" ? !next.HomeOdds : !next.AwayOdds),
    }, "mqtt");
  }

  const wsHandle = startLimitlessMarketWs({
    onOrderbook: (update) => {
      const slug = String(update.marketSlug ?? "");
      const ask = bestAskFromBook(update.orderbook);
      if (slug && ask > 0)
        updateBetFromSlug(slug, ask);
    },
  });

  const runDiscovery = async () => {
    while (!collect.ready) {
      if (stopped)
        return;
      await wait(500);
    }

    const rawGroups = await fetchLimitlessEsportsGroups();
    const filtered = rawGroups.filter((group) => {
      if (!isLimitlessEsportsMatchWinnerGroup(group))
        return false;
      const startMs = Number(group.metadata?.startMatchTimestampInUTC ?? 0) * 1000;
      return limitlessCollectStartTimeAllowed(startMs);
    });

    const slugList: string[] = [];
    for (const group of filtered) {
      const meta = group.metadata!;
      const home = group.markets?.find(m => m.title === meta.homeTeam);
      const away = group.markets?.find(m => m.title === meta.awayTeam);
      if (home?.slug)
        slugList.push(home.slug);
      if (away?.slug)
        slugList.push(away.slug);
    }
    const buyPrices = await fetchBuyPricesForSlugs(slugList);

    const candidates: LimitlessMappedMarket[] = [];
    for (const group of filtered) {
      const mapped = buildLimitlessMappedMarket(group, buyPrices);
      if (mapped)
        candidates.push(mapped);
      if (candidates.length >= MAX_TRACKED_MARKETS)
        break;
    }
    if (!candidates.length)
      return;

    const matches = [...new Map(candidates.map(row => [String(row.match.SourceMatchID), row.match])).values()];
    const saved = await collect.saveMatch(PLATFORM, matches);
    const shouldSaveBets = saved && Date.now() - lastSaveBetsAt >= SAVE_BETS_INTERVAL_MS;

    const betsByMatch = new Map<string, CollectBetDto[]>();
    for (const mapped of candidates) {
      marketsById.set(mapped.marketId, mapped);
      slugToMarket.set(mapped.homeSlug, mapped.marketId);
      slugToMarket.set(mapped.awaySlug, mapped.marketId);
      saveBetOddsToFo(mapped.bet, "http", {
        home: buyPrices[mapped.homeSlug],
        away: buyPrices[mapped.awaySlug],
      });
      if (shouldSaveBets) {
        const sid = String(mapped.match.SourceMatchID);
        if (!betsByMatch.has(sid))
          betsByMatch.set(sid, []);
        betsByMatch.get(sid)!.push(mapped.bet);
      }
    }
    if (shouldSaveBets) {
      for (const [sid, bets] of betsByMatch)
        await collect.saveBets(PLATFORM, sid, bets);
      lastSaveBetsAt = Date.now();
    }
    matchStore.refreshOddsOnBets();
    wsHandle.subscribeSlugs(trackedSlugs());
  };

  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      try {
        if (!hasA8PluginRuntime()) {
          if (!pluginMissingNotified) {
            notifyCollectError("Limitless", LIMITLESS_PLUGIN_REQUIRED_MSG);
            pluginMissingNotified = true;
          }
          await wait(DISCOVERY_MS);
          continue;
        }
        pluginMissingNotified = false;
        await runDiscovery();
      }
      catch (err) {
        console.warn("[Limitless] collect error", err);
        notifyCollectError("Limitless", err);
      }
      await wait(DISCOVERY_MS);
    }
  };

  void loop();

  return () => {
    stopped = true;
    wsHandle.stop();
  };
}

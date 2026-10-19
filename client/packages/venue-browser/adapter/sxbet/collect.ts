/**
 * SXBet 电竞：VPS 写 platform_* + MarketIndex；浏览器 Index → Centrifugo best_odds → fo。
 * **禁止**浏览器 SaveMatch/SaveBets（VPS collector 独占）。
 */
import { getCollectPlatform } from "@changmen/client-core/bridge/clientApi";
import { saveVenueOdds, getVenueOddsEntry } from "@changmen/client-core/bridge/oddsAccess";
import type { CollectBetDto } from "@changmen/client-core/types/collect";
import { PLATFORMS } from "../shared/platforms";
import { wait } from "@changmen/client-core/shared/wait";
import { notifyCollectError } from "../shared/collectNotify";
import { useMatchStore } from "../shared/webBridge";

import { SXBET_ESPORTS_SPORT_ID, type SxBestOddsRow, type SxBestOddsWsUpdate } from "./api";
import { applySxBetMarketIndex, isSxBetMarketIndex, type SxTrackedMarket } from "./marketIndex";
import {
  applySxBestOddsWsUpdate,
  bestSxDecimalOddsFromBestRow,
} from "./parse";
import { startSxBetBestOddsWs } from "./ws";

const PLATFORM = PLATFORMS.SXBet;
const INDEX_SYNC_MS = 30_000;

function saveBetOddsToFo(bet: CollectBetDto, source: "http" | "mqtt") {
  const locked = bet.Status === "Locked";
  const betId = String(bet.SourceBetID);
  const now = Date.now();
  const homeId = String(bet.SourceHomeID);
  const awayId = String(bet.SourceAwayID);

  // Index 种子：若该 id 已有 WS(mqtt) 价，勿用慢 Index 盖掉
  if (source === "http") {
    const prevHome = getVenueOddsEntry(PLATFORM, homeId);
    if (!(prevHome?.source === "mqtt")) {
      saveVenueOdds(PLATFORM, {
        id: homeId,
        odds: bet.HomeOdds,
        isLock: locked || !bet.HomeOdds,
        betId,
        side: "home",
        time: now,
      }, source);
    }
    const prevAway = getVenueOddsEntry(PLATFORM, awayId);
    if (!(prevAway?.source === "mqtt")) {
      saveVenueOdds(PLATFORM, {
        id: awayId,
        odds: bet.AwayOdds,
        isLock: locked || !bet.AwayOdds,
        betId,
        side: "away",
        time: now,
      }, source);
    }
    return;
  }

  saveVenueOdds(PLATFORM, {
    id: homeId,
    odds: bet.HomeOdds,
    isLock: locked || !bet.HomeOdds,
    betId,
    side: "home",
    time: now,
  }, source);
  saveVenueOdds(PLATFORM, {
    id: awayId,
    odds: bet.AwayOdds,
    isLock: locked || !bet.AwayOdds,
    betId,
    side: "away",
    time: now,
  }, source);
}

function applyBestOddsUpdate(
  marketsByHash: Map<string, SxTrackedMarket>,
  bestByHash: Map<string, SxBestOddsRow>,
  update: SxBestOddsWsUpdate,
  matchStore: ReturnType<typeof useMatchStore>,
) {
  if (Number(update.sportId) > 0 && Number(update.sportId) !== SXBET_ESPORTS_SPORT_ID)
    return;
  const hash = String(update.marketHash ?? "").trim();
  if (!hash)
    return;
  const mapped = marketsByHash.get(hash);
  if (!mapped)
    return;

  const prev = bestByHash.get(hash);
  const nextRow = applySxBestOddsWsUpdate(prev, update);
  bestByHash.set(hash, nextRow);

  const homeOdds = bestSxDecimalOddsFromBestRow(nextRow, true);
  const awayOdds = bestSxDecimalOddsFromBestRow(nextRow, false);
  const next: CollectBetDto = {
    ...mapped.bet,
    HomeOdds: homeOdds,
    AwayOdds: awayOdds,
    Status: homeOdds > 0 && awayOdds > 0 ? "Normal" : "Locked",
  };
  mapped.bet = next;
  saveBetOddsToFo(next, "mqtt");
  matchStore.refreshOddsOnBets();
}

export function startSxBetCollector(): () => void {
  const matchStore = useMatchStore();
  const marketsByHash = new Map<string, SxTrackedMarket>();
  const bestByHash = new Map<string, SxBestOddsRow>();
  let lastIndexUpdatedAt = 0;

  const wsHandle = startSxBetBestOddsWs({
    onUpdate: (update) => {
      applyBestOddsUpdate(marketsByHash, bestByHash, update, matchStore);
    },
  });

  const syncIndex = async () => {
    const platform = await getCollectPlatform(PLATFORM);
    const index = isSxBetMarketIndex(platform?.MarketIndex) ? platform.MarketIndex : null;
    const updatedAt = Number(index?.updatedAt) || 0;
    if (updatedAt && updatedAt === lastIndexUpdatedAt)
      return;
    lastIndexUpdatedAt = updatedAt;

    applySxBetMarketIndex(index, { marketsByHash });
    for (const hash of [...bestByHash.keys()]) {
      if (!marketsByHash.has(hash))
        bestByHash.delete(hash);
    }
    for (const tracked of marketsByHash.values())
      saveBetOddsToFo(tracked.bet, "http");
    matchStore.refreshOddsOnBets();
    wsHandle.setMarketHashes([...marketsByHash.keys()]);
    void wsHandle.ensureConnected();
  };

  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      try {
        await syncIndex();
      }
      catch (err) {
        console.warn("[SXBet] index sync error", err);
        notifyCollectError("SXBet", err);
      }
      await wait(INDEX_SYNC_MS);
    }
  };

  void loop();

  return () => {
    stopped = true;
    wsHandle.stop();
  };
}

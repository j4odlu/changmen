import { saveVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import { PLATFORMS } from "../shared/platforms";
import { directGet } from "@changmen/client-core/shared/http";
import { wait } from "@changmen/client-core/shared/wait";
import { notifyCollectError } from "../shared/collectNotify";
import { useCollectStore } from "../shared/webBridge";
import { useMatchStore } from "../shared/webBridge";

import {
  DEX_LINE_API,
  DEX_CID,
  dexSportSlugs,
  parseTopEvents,
  dexEventToMatch,
  parseInlineMarkets,
} from "./parse";
import { startDexSocket, stopDexSocket, onDexBatch } from "./socket";
import type { DexBatchItem } from "./socket";
import type { CollectBetDto } from "@changmen/client-core/types/collect";

const LOOP_MS = 30_000;
const WS_SAVE_INTERVAL_MS = 30_000;

function mapFromName(name: string): number {
  const lower = name.toLowerCase();
  const m = /map\s*(\d)\b/.exec(lower);
  if (m) return Number(m[1]);
  const cn = /(\d)\s*号地图|地图\s*(\d)/.exec(name);
  if (cn) return Number(cn[1] || cn[2]);
  return 0;
}

export function startDexCollector(): () => void {
  let stopped = false;

  const collect = useCollectStore();
  const matchStore = useMatchStore();

  interface MarketCache {
    eventId: string;
    name: string;
    map: number;
    marketId: string;
    home?: { id: string; name: string; odds: number; frozen: boolean };
    away?: { id: string; name: string; odds: number; frozen: boolean };
  }
  const marketCache = new Map<string, MarketCache>();
  let lastWsSaveAt = 0;
  const pendingSave = new Map<string, { matchId: string; bet: CollectBetDto }>();
  function flushWsBets() {
    if (!pendingSave.size) return;
    const byMatch = new Map<string, CollectBetDto[]>();
    for (const { matchId, bet } of pendingSave.values()) {
      if (!byMatch.has(matchId)) byMatch.set(matchId, []);
      byMatch.get(matchId)!.push(bet);
    }
    pendingSave.clear();
    for (const [matchId, bets] of byMatch) {
      void collect.saveBets(PLATFORMS.Dex, matchId, bets);
    }
    lastWsSaveAt = Date.now();
  }

  /** WS 推送：实时更新 UI（oddsStore），每 5 分钟批量 saveBets */
  function handleBatch(items: DexBatchItem[]) {
    if (!collect.ready || !collect.collect.get(PLATFORMS.Dex)) return;

    let updated = false;

    for (const item of items) {
      if (item.model !== "market") continue;
      const mkt = item.data;
      const name = String(mkt.name ?? "");
      if (!/winner|赢家|获胜/i.test(name) || /1x2/i.test(name)) continue;
      const outcomes = (mkt.outcomes ?? []) as Array<Record<string, unknown>>;
      if (outcomes.length < 1 || outcomes.length > 3) continue;

      const marketId = String(mkt.id ?? "");
      const eventLid = String(mkt.pid ?? "");
      const eventId = eventLid.split(".").pop() || eventLid;
      const map = mapFromName(name);

      if (!marketCache.has(marketId)) {
        marketCache.set(marketId, { eventId, name, map, marketId });
      }
      const cache = marketCache.get(marketId)!;

      for (let i = 0; i < outcomes.length; i++) {
        const o = outcomes[i]!;
        if (!o.id) continue;
        const frozen = Boolean(o.isFrozen);
        const price = !frozen ? Number(o.price ?? 0) : 0;
        const oid = String(o.id);

        saveVenueOdds(PLATFORMS.Dex, {
          id: oid,
          odds: price,
          isLock: frozen,
          betId: marketId,
          time: Date.now(),
        });
        updated = true;

        const identity = Number(o.identity ?? 0);
        let slot: "home" | "away";
        if (identity === 103) slot = "away";
        else if (identity === 101) slot = "home";
        else if (cache.home && cache.home.id === oid) slot = "home";
        else if (cache.away && cache.away.id === oid) slot = "away";
        else slot = i === 0 && !cache.home ? "home" : "away";

        cache[slot] = { id: oid, name: String(o.name ?? ""), odds: price, frozen };
      }
      if (cache.home && cache.away && eventId) {
        const locked = cache.home.frozen && cache.away.frozen;
        pendingSave.set(marketId, {
          matchId: eventId,
          bet: {
            Type: PLATFORMS.Dex,
            SourceMatchID: eventId,
            Map: map,
            SourceBetID: marketId,
            BetName: name,
            SourceHomeID: cache.home.id,
            HomeName: cache.home.name,
            HomeOdds: cache.home.odds,
            SourceAwayID: cache.away.id,
            AwayName: cache.away.name,
            AwayOdds: cache.away.odds,
            Status: locked ? "Locked" : "Normal",
          },
        });
      }
    }

    if (updated) {
      matchStore.refreshOddsOnBets();
    }

    if (Date.now() - lastWsSaveAt >= WS_SAVE_INTERVAL_MS) {
      flushWsBets();
    }
  };

  /** HTTP 轮询：全量快照写数据库（saveMatch + saveBets） */
  const runCycle = async () => {
    while (!collect.ready) {
      if (stopped) return;
      await wait(500);
    }

    const matches = [];
    const betsToSave: Array<{ matchId: string; bets: CollectBetDto[] }> = [];

    for (const slug of dexSportSlugs()) {
      try {
        const url = `${DEX_LINE_API}/top-events/${slug}?cid=${DEX_CID}&locale=zh`;
        const rawData = await directGet<{ data?: unknown[] }>(url, {});
        const list = Array.isArray(rawData) ? rawData : rawData?.data;
        const events = parseTopEvents(slug, list);

        for (const ev of events) {
          matches.push(dexEventToMatch(ev));
        }

        if (Array.isArray(list)) {
          for (const item of list) {
            const raw = item as Record<string, unknown>;
            const eventId = String(raw.id ?? "");
            const markets = (raw.markets ?? []) as unknown[];
            if (eventId && markets.length) {
              const bets = parseInlineMarkets(eventId, markets);
              if (bets.length) betsToSave.push({ matchId: eventId, bets });
            }
          }
        }
      } catch (err) {
        console.warn(`[Dex] ${slug} failed`, err);
      }
    }

    // [A8 可证实] Stake/Dex 同类 GraphQL 路径：空列表仍 saveMatch
    await collect.saveMatch(PLATFORMS.Dex, matches);
    for (const { matchId, bets } of betsToSave) {
      if (bets.length) await collect.saveBets(PLATFORMS.Dex, matchId, bets);
    }

    for (const { bets } of betsToSave) {
      for (const b of bets) {
        const locked = b.Status === "Locked";
        if (b.SourceHomeID) {
          saveVenueOdds(PLATFORMS.Dex, {
            id: String(b.SourceHomeID),
            odds: b.HomeOdds,
            isLock: locked,
            betId: String(b.SourceBetID),
            time: Date.now(),
          });
        }
        if (b.SourceAwayID) {
          saveVenueOdds(PLATFORMS.Dex, {
            id: String(b.SourceAwayID),
            odds: b.AwayOdds,
            isLock: locked,
            betId: String(b.SourceBetID),
            time: Date.now(),
          });
        }
      }
    }
    matchStore.refreshOddsOnBets();
  };

  const unsubBatch = onDexBatch(handleBatch);
  void startDexSocket();

  const loop = async () => {
    while (!stopped) {
      try {
        await runCycle();
      } catch (err) {
        console.warn("[Dex] collect error", err);
        notifyCollectError("Dex", err);
      }
      await wait(LOOP_MS);
    }
  };

  void loop();

  return () => {
    stopped = true;
    unsubBatch();
    stopDexSocket();
  };
}

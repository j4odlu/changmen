import { saveVenueOdds } from "@changmen/client-core/bridge/oddsAccess";
import type { CollectBetDto } from "@changmen/client-core/types/collect";
import { PLATFORMS } from "../shared/platforms";
import { wait } from "@changmen/client-core/shared/wait";
import { notifyCollectError } from "../shared/collectNotify";
import { useCollectStore } from "../shared/webBridge";
import { useMatchStore } from "../shared/webBridge";

import {
  azuroCollectStartTimeAllowed,
  fetchAllAzuroEsportsGames,
  fetchAzuroConditions,
} from "./api";
import {
  buildAzuroMappedMarket,
  foOutcomeId,
  isAzuroMatchWinnerCondition,
  parseAzuroDecimalOdds,
  type AzuroCondition,
  type AzuroMappedMarket,
} from "./parse";
import { startAzuroConditionWs } from "./ws";

const PLATFORM = PLATFORMS.Azuro;
const DISCOVERY_MS = 60_000;
const SAVE_BETS_INTERVAL_MS = 5 * 60_000;
const MAX_TRACKED_MARKETS = 200;
const CONDITION_BATCH = 20;

function saveOutcomeOdds(
  conditionId: string,
  outcomeId: string,
  betId: string,
  side: "home" | "away",
  odds: number,
  locked: boolean,
  source: "http" | "mqtt",
) {
  saveVenueOdds(PLATFORM, {
    id: foOutcomeId(conditionId, outcomeId),
    odds,
    isLock: locked || !odds,
    betId,
    side,
    time: Date.now(),
  }, source);
}

function saveBetOddsToFo(bet: CollectBetDto, source: "http" | "mqtt", conditionId: string) {
  const locked = bet.Status === "Locked";
  const betId = String(bet.SourceBetID);
  saveOutcomeOdds(conditionId, String(bet.SourceHomeID), betId, "home", bet.HomeOdds, locked, source);
  saveOutcomeOdds(conditionId, String(bet.SourceAwayID), betId, "away", bet.AwayOdds, locked, source);
}

function applyConditionUpdate(
  marketsById: Map<string, AzuroMappedMarket>,
  condition: AzuroCondition,
  matchStore: ReturnType<typeof useMatchStore>,
) {
  const conditionId = String(condition.conditionId ?? condition.id ?? "");
  if (!conditionId)
    return;
  const mapped = marketsById.get(conditionId);
  if (!mapped || !isAzuroMatchWinnerCondition(condition))
    return;

  const outcomes = (condition.outcomes ?? []).filter(o => o.state === "Active" && !o.hidden);
  const homeRaw = outcomes.find(o => String(o.outcomeId) === mapped.homeOutcomeId);
  const awayRaw = outcomes.find(o => String(o.outcomeId) === mapped.awayOutcomeId);
  const homeOdds = parseAzuroDecimalOdds(homeRaw?.odds);
  const awayOdds = parseAzuroDecimalOdds(awayRaw?.odds);

  const next: CollectBetDto = {
    ...mapped.bet,
    HomeOdds: homeOdds || mapped.bet.HomeOdds,
    AwayOdds: awayOdds || mapped.bet.AwayOdds,
    Status: homeOdds > 0 && awayOdds > 0 ? "Normal" : "Locked",
  };
  mapped.bet = next;
  saveBetOddsToFo(next, "mqtt", conditionId);
  matchStore.refreshOddsOnBets();
}

export function startAzuroCollector(): () => void {
  let lastSaveBetsAt = 0;
  const collect = useCollectStore();
  const matchStore = useMatchStore();
  const marketsById = new Map<string, AzuroMappedMarket>();

  const wsHandle = startAzuroConditionWs({
    onCondition: (condition) => {
      applyConditionUpdate(marketsById, condition, matchStore);
    },
  });

  const runDiscovery = async () => {
    while (!collect.ready) {
      if (stopped)
        return;
      await wait(500);
    }

    const games = (await fetchAllAzuroEsportsGames()).filter((game) => {
      const startMs = Number(game.startsAt ?? 0) * 1000;
      return azuroCollectStartTimeAllowed(startMs);
    });
    if (!games.length)
      return;

    const conditions: AzuroCondition[] = [];
    for (let i = 0; i < games.length; i += CONDITION_BATCH) {
      const batchIds = games.slice(i, i + CONDITION_BATCH).map(g => String(g.gameId ?? g.id ?? ""));
      const rows = await fetchAzuroConditions(batchIds);
      conditions.push(...rows);
    }

    const gameById = new Map(games.map(g => [String(g.gameId ?? g.id ?? ""), g]));
    const candidates: AzuroMappedMarket[] = [];
    for (const condition of conditions) {
      if (!isAzuroMatchWinnerCondition(condition))
        continue;
      const gameId = String(condition.game?.gameId ?? "");
      const game = gameById.get(gameId);
      if (!game)
        continue;
      const mapped = buildAzuroMappedMarket(game, condition);
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
      marketsById.set(mapped.conditionId, mapped);
      saveBetOddsToFo(mapped.bet, "http", mapped.conditionId);
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
    wsHandle.subscribeConditionIds(candidates.map(row => row.conditionId));
  };

  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      try {
        await runDiscovery();
      }
      catch (err) {
        console.warn("[Azuro] collect error", err);
        notifyCollectError("Azuro", err);
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

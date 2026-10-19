/**
 * [changmen 扩展] 正 EV 自动下注。
 * 挂在 mainBetLoop：仅 autoBet.enabled 时扫描；每轮最多下一笔。
 * 条件：edge 在 EV 区间内、基准该侧赔率在区间内、同图次数未满、地图未折叠。
 */
import type { BetSide, ViewBet, ViewBetItem, ViewMatch } from "@/models/match";
import type { ValueBetAutoBetPrefs } from "@/types/extensionPrefs";
import { accountsFundingReady } from "@/stores/account/accountPicker";
import { isMapMuteActive } from "@/extensions/mapBetMute";
import { isPrematchFullMarketAllowed } from "@/extensions/prematchFullOnly";
import {
  computeValueBetEdge,
  type ValueBetEdgeSnapshot,
} from "@/extensions/valueBet/computeValueBetEdge";
import {
  coerceValueBetAutoBetRuntime,
  valueBetCalcOptsFromPrefs,
  type ValueBetCalcOpts,
} from "@/extensions/valueBet/evConfig";
import { getValueBetMapCount, valueBetMapKey } from "@/extensions/valueBet/valueBetMapCount";
import { resolveValueBetStake } from "@/extensions/valueBet/valueBetStake";
import { useAccountStore } from "@/stores/accountStore";
import { isValueBetPlaceInFlight, placeValueBetOrder } from "@/stores/betting/placeValueBet";
import { useMatchStore } from "@/stores/matchStore";
import { useUserStore } from "@/stores/userStore";

export const VALUE_BET_AUTO_FAIL_COOLDOWN_MS = 5_000;

export interface ValueBetAutoGateInput {
  enabled: boolean;
  edge: number;
  minEdge: number;
  maxEdge: number;
  sharpOdds: number;
  minOdds: number;
  maxOdds: number;
  mapCount: number;
  maxPerMap: number;
}

export function isValueBetAutoEligible(input: ValueBetAutoGateInput): boolean {
  if (!input.enabled)
    return false;
  if (!(Number.isFinite(input.minEdge) && Number.isFinite(input.maxEdge) && input.minEdge <= input.maxEdge))
    return false;
  if (!(Number.isFinite(input.edge) && input.edge >= input.minEdge && input.edge <= input.maxEdge))
    return false;
  if (!(Number.isFinite(input.minOdds) && Number.isFinite(input.maxOdds) && input.minOdds <= input.maxOdds))
    return false;
  if (!(Number.isFinite(input.sharpOdds) && input.sharpOdds >= input.minOdds && input.sharpOdds <= input.maxOdds))
    return false;
  if (!(Number.isFinite(input.maxPerMap) && input.maxPerMap >= 1))
    return false;
  return input.mapCount < input.maxPerMap;
}

export function sharpOddsForSide(snap: ValueBetEdgeSnapshot, side: BetSide): number {
  return side === "Home" ? snap.sharpHome : snap.sharpAway;
}

export interface ValueBetAutoCandidate {
  match: ViewMatch;
  bet: ViewBet;
  item: ViewBetItem;
  side: BetSide;
  snap: ValueBetEdgeSnapshot;
  sharpOdds: number;
}

export interface CollectValueBetAutoCtx {
  isMuted: (matchId: number, round: number, liveRound: number) => boolean;
  mapCount: (matchId: number, round: number) => number;
  isCooling: (matchId: number, round: number) => boolean;
}

export function collectValueBetAutoCandidates(
  matches: ViewMatch[],
  calcOpts: ValueBetCalcOpts,
  autoBet: Pick<ValueBetAutoBetPrefs, "enabled" | "minEdgePct" | "maxEdgePct" | "minOdds" | "maxOdds" | "maxPerMap">,
  ctx: CollectValueBetAutoCtx,
): ValueBetAutoCandidate[] {
  const gate = coerceValueBetAutoBetRuntime(autoBet);
  const out: ValueBetAutoCandidate[] = [];
  if (!autoBet.enabled)
    return out;

  for (const match of matches) {
    for (const bet of match.bets) {
      if (!isPrematchFullMarketAllowed(match, bet))
        continue;
      if (ctx.isMuted(match.id, bet.round, match.liveRound))
        continue;
      if (ctx.isCooling(match.id, bet.round))
        continue;
      const mapCount = ctx.mapCount(match.id, bet.round);
      if (mapCount >= gate.maxPerMap)
        continue;

      for (const item of bet.items) {
        for (const side of ["Home", "Away"] as BetSide[]) {
          const snap = computeValueBetEdge(bet, item, side, calcOpts);
          if (!snap)
            continue;
          const sharpOdds = sharpOddsForSide(snap, side);
          if (!isValueBetAutoEligible({
            enabled: true,
            edge: snap.edge,
            minEdge: gate.minEdge,
            maxEdge: gate.maxEdge,
            sharpOdds,
            minOdds: gate.minOdds,
            maxOdds: gate.maxOdds,
            mapCount,
            maxPerMap: gate.maxPerMap,
          }))
            continue;
          out.push({ match, bet, item, side, snap, sharpOdds });
        }
      }
    }
  }

  out.sort((a, b) => b.snap.edge - a.snap.edge);
  return out;
}

const failCooldownUntil = new Map<string, number>();
let tickInFlight = false;

export function isValueBetAutoCooling(matchId: number, round: number, now = Date.now()): boolean {
  const until = failCooldownUntil.get(valueBetMapKey(matchId, round)) ?? 0;
  return until > now;
}

export function markValueBetAutoCooldown(matchId: number, round: number, now = Date.now()): void {
  failCooldownUntil.set(valueBetMapKey(matchId, round), now + VALUE_BET_AUTO_FAIL_COOLDOWN_MS);
}

export function resetValueBetAutoBetForTests(): void {
  tickInFlight = false;
  failCooldownUntil.clear();
}

export async function runValueBetAutoBetTick(): Promise<void> {
  if (tickInFlight || isValueBetPlaceInFlight())
    return;

  const user = useUserStore();
  const autoBet = user.extensionPrefs?.valueBet?.autoBet;
  if (autoBet?.enabled !== true)
    return;

  tickInFlight = true;
  try {
    const amount = resolveValueBetStake(user.config);
    if (amount <= 0)
      return;

    const accountStore = useAccountStore();
    if (!accountsFundingReady(accountStore))
      return;

    const matchStore = useMatchStore();
    const calcOpts = valueBetCalcOptsFromPrefs({
      ...user.extensionPrefs?.valueBet,
      softPlatforms: user.extensionPrefs?.valueBetSoftPlatforms,
    });
    const gate = coerceValueBetAutoBetRuntime(autoBet);
    const autoGate = {
      minEdge: gate.minEdge,
      maxEdge: gate.maxEdge,
      minOdds: gate.minOdds,
      maxOdds: gate.maxOdds,
      maxPerMap: gate.maxPerMap,
    };
    const candidates = collectValueBetAutoCandidates(
      matchStore.matchs,
      calcOpts,
      autoBet,
      {
        isMuted: isMapMuteActive,
        mapCount: getValueBetMapCount,
        isCooling: (matchId, round) => isValueBetAutoCooling(matchId, round),
      },
    );
    if (!candidates.length)
      return;

    for (const c of candidates) {
      if (isValueBetPlaceInFlight())
        return;
      const placed = await placeValueBetOrder({
        match: c.match,
        bet: c.bet,
        item: c.item,
        side: c.side,
        amount,
        calcOpts,
        minEdge: gate.minEdge,
        silent: true,
        autoGate,
      });
      if (placed.ok) {
        matchStore.setBettingMessage(
          placed.pending
            ? `正EV自动确认中 ${placed.type}@${placed.odds} +${(placed.edge * 100).toFixed(1)}%`
            : `正EV自动 ${placed.type}@${placed.odds} +${(placed.edge * 100).toFixed(1)}%`,
        );
        return;
      }
      if (placed.code === "busy")
        return;
      if (placed.code === "map_limit" || placed.code === "muted" || placed.code === "no_account"
        || placed.code === "filter" || placed.code === "rate_9999" || placed.code === "balance")
        continue;
      if (placed.code === "gone" || placed.code === "check_fail" || placed.code === "place_fail") {
        markValueBetAutoCooldown(c.match.id, c.bet.round);
        matchStore.setBettingMessage(
          `正EV自动跳过 ${c.item.type}: ${placed.message || placed.code}`,
        );
        return;
      }
    }
  }
  finally {
    tickInFlight = false;
  }
}

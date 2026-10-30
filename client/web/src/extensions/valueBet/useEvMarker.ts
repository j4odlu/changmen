import type { MaybeRefOrGetter } from "vue";
import type { BetSide, ViewBet, ViewBetItem } from "@/models/match";
import { computed, toValue } from "vue";
import { useOddsStore } from "@/stores/oddsStore";
import { useUserStore } from "@/stores/userStore";
import { calcEdge, valueBetFairOdds } from "./evCalc";
import { evMarkerFloor, valueBetCalcOptsFromPrefs } from "./evConfig";

interface EvEntry {
  edge: number;
  fairOdds: number;
}

export function useEvMarker(
  bet: MaybeRefOrGetter<ViewBet>,
  enabled: MaybeRefOrGetter<boolean> = true,
) {
  const active = computed(() => toValue(enabled) !== false);
  const oddsStore = useOddsStore();
  const user = useUserStore();
  const calcOpts = computed(() => valueBetCalcOptsFromPrefs({
    ...user.extensionPrefs?.valueBet,
    softPlatforms: user.extensionPrefs?.valueBetSoftPlatforms,
  }));

  function readOdds(item: ViewBetItem, side: BetSide): number {
    const id = item.getItemId(side);
    const fallback = side === "Home" ? item.fallbackHomeOdds : item.fallbackAwayOdds;
    return oddsStore.getOdds(item.type, id, fallback);
  }

  const evMap = computed(() => {
    if (!active.value)
      return new Map<string, EvEntry>();
    const b = toValue(bet);
    const map = new Map<string, EvEntry>();
    const { sharp, nearEdge, minEdge, softPlatforms } = calcOpts.value;
    const floor = evMarkerFloor(nearEdge, minEdge);

    const sharpItem = b.items.find(it => it.type === sharp);
    if (!sharpItem)
      return map;

    const sharpHome = readOdds(sharpItem, "Home");
    const sharpAway = readOdds(sharpItem, "Away");
    if (!sharpHome || !sharpAway)
      return map;

    const fair = valueBetFairOdds(sharpHome, sharpAway, calcOpts.value);
    if (!fair)
      return map;

    for (const item of b.items) {
      if (item.type === sharp)
        continue;
      if (!softPlatforms.includes(item.type))
        continue;

      for (const side of ["Home", "Away"] as BetSide[]) {
        const softOdds = readOdds(item, side);
        if (!softOdds)
          continue;
        const fairOdds = side === "Home" ? fair.fairHome : fair.fairAway;
        const edge = calcEdge(softOdds, fairOdds);
        if (edge >= floor)
          map.set(`${item.type}:${side}`, { edge, fairOdds });
      }
    }

    return map;
  });

  function _get(item: ViewBetItem, side: BetSide): EvEntry | undefined {
    return evMap.value.get(`${item.type}:${side}`);
  }

  function isPositiveEv(item: ViewBetItem, side: BetSide): boolean {
    const e = _get(item, side);
    return !!e && e.edge >= calcOpts.value.minEdge;
  }

  function isNearEv(item: ViewBetItem, side: BetSide): boolean {
    const e = _get(item, side);
    return !!e && e.edge >= calcOpts.value.nearEdge && e.edge < calcOpts.value.minEdge;
  }

  function evLabel(item: ViewBetItem, side: BetSide): string | undefined {
    const e = _get(item, side);
    if (!e)
      return undefined;
    return `+${(e.edge * 100).toFixed(1)}%`;
  }

  const hasSharpBaseline = computed(() => {
    if (!active.value)
      return false;
    const b = toValue(bet);
    const sharpItem = b.items.find(it => it.type === calcOpts.value.sharp);
    if (!sharpItem)
      return false;
    return !!valueBetFairOdds(readOdds(sharpItem, "Home"), readOdds(sharpItem, "Away"), calcOpts.value);
  });

  return { isPositiveEv, isNearEv, evLabel, hasSharpBaseline };
}

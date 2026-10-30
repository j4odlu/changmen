import type { BetSide, ViewBet, ViewBetItem } from "@/models/match";
import type { PlatformId } from "@/types/esport";
import { calcEdge, valueBetFairOdds } from "@/extensions/valueBet/evCalc";
import {
  MIN_EDGE,
  normalizeValueBetSharp,
  resolveSoftPlatforms,
  type ValueBetCalcOpts,
} from "@/extensions/valueBet/evConfig";

export interface ValueBetEdgeSnapshot {
  softOdds: number;
  fairOdds: number;
  edge: number;
  sharpHome: number;
  sharpAway: number;
}

function resolveSharp(opts?: Pick<ValueBetCalcOpts, "sharp" | "softPlatforms" | "pmMaxOverroundPct"> | null) {
  const sharp = normalizeValueBetSharp(opts?.sharp);
  const softPlatforms = opts?.softPlatforms ?? resolveSoftPlatforms(sharp);
  return { sharp, softPlatforms, pmMaxOverroundPct: opts?.pmMaxOverroundPct };
}

/** 相对所选 sharp 基准重算单边 edge；不满足软庄/sharp 条件时返回 null */
export function computeValueBetEdge(
  bet: ViewBet,
  item: ViewBetItem,
  side: BetSide,
  opts?: Pick<ValueBetCalcOpts, "sharp" | "softPlatforms" | "pmMaxOverroundPct"> | null,
): ValueBetEdgeSnapshot | null {
  const resolved = resolveSharp(opts);
  const { sharp, softPlatforms } = resolved;
  if (item.type === sharp)
    return null;
  if (!softPlatforms.includes(item.type as PlatformId))
    return null;

  const sharpItem = bet.items.find(it => it.type === sharp);
  if (!sharpItem)
    return null;

  const sharpHome = sharpItem.getOdds("Home");
  const sharpAway = sharpItem.getOdds("Away");
  if (!sharpHome || !sharpAway)
    return null;

  const fair = valueBetFairOdds(sharpHome, sharpAway, resolved);
  if (!fair)
    return null;

  const softOdds = item.getOdds(side);
  if (!softOdds)
    return null;

  const fairOdds = side === "Home" ? fair.fairHome : fair.fairAway;
  const edge = calcEdge(softOdds, fairOdds);
  return {
    softOdds,
    fairOdds,
    edge,
    sharpHome,
    sharpAway,
  };
}

export function isValueBetPositiveEdge(edge: number, minEdge = MIN_EDGE): boolean {
  return Number.isFinite(edge) && edge >= minEdge;
}

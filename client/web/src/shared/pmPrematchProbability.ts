import type { PmPrematchTokenSnapshot } from "@changmen/api-contract";

export interface PrematchProbability {
  home: number;
  away: number;
  homeTime: number;
  awayTime: number;
  resolution: number;
  cutoff: number;
}

export type PrematchResult =
  | { status: "ready"; value: PrematchProbability }
  | { status: "waiting" | "pending" | "missing" | "error" };

function validPoint(point: PmPrematchTokenSnapshot): boolean {
  return point.status === "ready" && typeof point.price === "number"
    && Number.isFinite(point.price) && point.price >= 0 && point.price <= 1
    && typeof point.observationTime === "number" && Number.isFinite(point.observationTime)
    && point.observationTime > 0 && point.observationTime <= point.cutoff * 1000
    && typeof point.resolution === "number" && Number.isFinite(point.resolution) && point.resolution >= 0;
}

/** [changmen 扩展] 浏览器只展示 VPS 下发结果，按 token 对齐主客，不请求 PM。 */
export function readPrematchProbability(
  homeId: string, awayId: string, snapshots: Record<string, PmPrematchTokenSnapshot> | undefined,
): PrematchResult {
  const home = snapshots?.[homeId];
  const away = snapshots?.[awayId];
  if (!home || !away) return { status: "waiting" };
  if (home.tokenId !== homeId || away.tokenId !== awayId || home.marketId !== away.marketId
    || home.cutoff !== away.cutoff) return { status: "waiting" };
  if (home.status === "pending" || away.status === "pending") return { status: "pending" };
  if (home.status === "error" || away.status === "error") return { status: "error" };
  if (!validPoint(home) || !validPoint(away)) return { status: "missing" };
  return { status: "ready", value: {
    home: home.price! * 100, away: away.price! * 100,
    homeTime: home.observationTime!, awayTime: away.observationTime!,
    resolution: Math.max(home.resolution!, away.resolution!), cutoff: home.cutoff * 1000,
  } };
}

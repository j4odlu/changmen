import { normalizeEpochMs } from "@changmen/shared/time/match_time";

/** 队名合并：±30 分钟 */
export const NAME_START_TOLERANCE_MS = 30 * 60 * 1000;
/** gb id 合并：±60 分钟 */
export const ID_START_TOLERANCE_MS = 60 * 60 * 1000;

export { normalizeEpochMs };

export function startTimesCompatibleId(aMs: unknown, bMs: unknown): boolean {
  const a = normalizeEpochMs(aMs);
  const b = normalizeEpochMs(bMs);
  if (!a || !b)
    return true;
  return Math.abs(a - b) <= ID_START_TOLERANCE_MS;
}

export function startTimesCompatibleName(aMs: unknown, bMs: unknown): boolean {
  const a = normalizeEpochMs(aMs);
  const b = normalizeEpochMs(bMs);
  if (!a || !b)
    return false;
  return Math.abs(a - b) <= NAME_START_TOLERANCE_MS;
}

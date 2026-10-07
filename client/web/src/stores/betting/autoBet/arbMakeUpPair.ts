import type { BetResult } from "@changmen/client-core/models/betResult";

export type ArbMakeUpEnqueueSide = "enqueueA" | "enqueueB";

/**
 * 锚腿：API 成功且场馆已确认 filled。
 * pendingConfirm（timeout / 仍 delayed）既非锚也非败 → 不入补单。
 */
function legFilledForMakeUpAnchor(
  result?: BetResult,
  venueConfirmedUnfilled = false,
  pendingConfirm = false,
): boolean {
  if (pendingConfirm || result?.pmSubmitUnknown)
    return false;
  return Boolean(result?.success && !venueConfirmedUnfilled && !result.reject);
}

/**
 * 败腿：API 失败，或场馆确认 unfilled。
 * timeout / result.reject==="timeout" 不算败（仍待确认）。
 */
function legFailedForMakeUpTarget(
  result?: BetResult,
  venueConfirmedUnfilled = false,
  pendingConfirm = false,
): boolean {
  if (pendingConfirm || result?.pmSubmitUnknown)
    return false;
  if (!result)
    return true;
  if (!result.success)
    return true;
  // 场馆已确认 unfilled 优先；仅 result.reject=timeout 且未确认时不算败
  if (venueConfirmedUnfilled)
    return true;
  if (result.reject === "timeout")
    return false;
  if (result.reject)
    return true;
  return false;
}

/** 套利补单配对：一腿 filled + 一腿确认未成交 → 补败腿；timeout 不入队 */
export function arbMakeUpSides(
  resultA?: BetResult,
  venueConfirmedUnfilledA = false,
  resultB?: BetResult,
  venueConfirmedUnfilledB = false,
  pendingConfirmA = false,
  pendingConfirmB = false,
): ArbMakeUpEnqueueSide | null {
  if (
    legFilledForMakeUpAnchor(resultA, venueConfirmedUnfilledA, pendingConfirmA)
    && legFailedForMakeUpTarget(resultB, venueConfirmedUnfilledB, pendingConfirmB)
  )
    return "enqueueB";

  if (
    legFilledForMakeUpAnchor(resultB, venueConfirmedUnfilledB, pendingConfirmB)
    && legFailedForMakeUpTarget(resultA, venueConfirmedUnfilledA, pendingConfirmA)
  )
    return "enqueueA";

  return null;
}

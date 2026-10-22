import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import type { ArbBetAttemptParams, ArbBetPlaced } from "@/stores/betting/autoBet/phases/types";
import { enqueueArbMakeUpSide } from "@/stores/betting/autoBet/arbMakeUpEnqueue";
import { resumeArbMakeUpPending } from "@/stores/betting/autoBet/arbMakeUpPending";
import { decideArbMakeUp } from "@/stores/betting/autoBet/arbMakeUpPolicy";
import { useLoseOrderStore } from "@/stores/loseOrderStore";

export { resolveArbMakeUpSuccessRef } from "@/stores/betting/autoBet/arbMakeUpEnqueue";

export interface ArbMakeUpVenueContext {
  ordersA: VenueOrder[];
  ordersB: VenueOrder[];
}

export interface ArbMakeUpEnqueueResult {
  enqueuedForLegA: boolean;
  enqueuedForLegB: boolean;
}

export interface ArbMakeUpPendingConfirm {
  pendingConfirmA?: boolean;
  pendingConfirmB?: boolean;
}

/** 编排层判定需补单后入队（不看 makeUp 开关）；赔率/初赔阈值在 enqueue 内按败腿价走 A8 `B()` */
export async function applyArbMakeUpFromRejects(
  params: ArbBetAttemptParams,
  placed: ArbBetPlaced,
  rejectA: boolean,
  rejectB: boolean,
  venue: ArbMakeUpVenueContext = { ordersA: [], ordersB: [] },
  pending: ArbMakeUpPendingConfirm = {},
): Promise<ArbMakeUpEnqueueResult> {
  // [A8 可证实] 入队不看 makeUp；消费段 `orders && config.makeUp` 才 jb
  const loseStore = useLoseOrderStore();
  const { betBothLegs, resultA, resultB } = placed;
  const result: ArbMakeUpEnqueueResult = {
    enqueuedForLegA: false,
    enqueuedForLegB: false,
  };

  const decision = decideArbMakeUp({
    betBothLegs,
    resultA,
    resultB,
    rejectA,
    rejectB,
    pendingConfirmA: pending.pendingConfirmA,
    pendingConfirmB: pending.pendingConfirmB,
  });
  if (decision.kind === "none")
    return result;

  if (decision.kind === "observe") {
    const { pendingSide, role } = decision;
    const queued = await resumeArbMakeUpPending({ params, placed, rejectA, rejectB, venue, loseStore }, pendingSide, role);
    const targetSide = role === "target" ? pendingSide : pendingSide === "A" ? "B" : "A";
    if (targetSide === "A")
      result.enqueuedForLegA = queued;
    else
      result.enqueuedForLegB = queued;
    return result;
  }

  return enqueueArbMakeUpSide({ params, placed, rejectA, rejectB, venue, loseStore }, decision.side);
}

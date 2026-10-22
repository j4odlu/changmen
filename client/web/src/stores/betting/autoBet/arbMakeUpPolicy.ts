import type { BetResult } from "@changmen/client-core/models/betResult";
import { arbMakeUpSides } from "@/stores/betting/autoBet/arbMakeUpPair";

export interface ArbMakeUpPolicyInput {
  betBothLegs: boolean;
  resultA?: BetResult;
  resultB?: BetResult;
  rejectA: boolean;
  rejectB: boolean;
  pendingConfirmA?: boolean;
  pendingConfirmB?: boolean;
}

export type ArbMakeUpDecision =
  | { kind: "none" }
  | { kind: "observe"; pendingSide: "A" | "B"; role: "target" | "anchor" }
  | { kind: "enqueue"; side: "A" | "B" };

/**
 * [changmen 扩展] 提取原套利补单决策，不读 store、不入队、不查询或下单。
 * 原模式资格仍由调用方控制；单边执行不套用双腿失败补单。
 * observe 只决定原单续查角色，账号、回执及入队门槛仍由原编排验证。
 */
export function decideArbMakeUp(input: ArbMakeUpPolicyInput): ArbMakeUpDecision {
  const { betBothLegs, resultA, resultB, rejectA, rejectB } = input;
  if (!betBothLegs)
    return { kind: "none" };

  const pendingConfirmA = Boolean(input.pendingConfirmA);
  const pendingConfirmB = Boolean(input.pendingConfirmB);
  // 保留原续查角色判定：这里不改用配对函数的锚腿条件。
  if (pendingConfirmA && !pendingConfirmB)
    return { kind: "observe", pendingSide: "A", role: resultB?.success && !rejectB ? "target" : "anchor" };
  if (pendingConfirmB && !pendingConfirmA)
    return { kind: "observe", pendingSide: "B", role: resultA?.success && !rejectA ? "target" : "anchor" };

  const side = arbMakeUpSides(resultA, rejectA, resultB, rejectB, pendingConfirmA, pendingConfirmB);
  if (side === "enqueueA")
    return { kind: "enqueue", side: "A" };
  if (side === "enqueueB")
    return { kind: "enqueue", side: "B" };
  return { kind: "none" };
}

/** [changmen 扩展] 原创建准入迁至客户端；仅持久化允许的执行字段，排除凭证。 */
import type { GtcPlan } from "@changmen/shared/pm_gtc";
import { gtcUnits } from "@changmen/shared/pm_gtc";
export function prepareLocalGtcPlan(submittedPlan: GtcPlan): GtcPlan {
  if (!submittedPlan || typeof submittedPlan !== "object")
    throw new Error("GTC 计划缺失");
  const plan = Object.fromEntries(["playerId", "otherPlayerId", "originalPmLeg", "otherProvider", "otherTarget", "otherOdds", "otherStake", "otherVenueMatchId", "otherVenueItemId", "matchId", "betRowId", "linkId", "tokenId", "conditionId", "target", "match", "bet", "item", "shares", "targetShares", "price", "maxPrincipal", "allInBudget", "fx", "parallel", "protocol", "negRisk", "route", "orderHash"].map(key => [key, submittedPlan[key as keyof GtcPlan]])) as unknown as GtcPlan;
  if (submittedPlan.source !== undefined && submittedPlan.source !== "manual")
    throw new Error("GTC 下单来源无效");
  const manual = submittedPlan.source === "manual";
  if (manual) {
    plan.source = "manual";
    if (plan.otherPlayerId !== 0 || plan.otherProvider !== "" || plan.otherOdds !== 0 || plan.otherStake !== 0
      || plan.originalPmLeg !== "A" || plan.parallel !== false) {
      throw new Error("手动 GTC 不能包含第二腿");
    }
  }
  const fee = submittedPlan.feeProof;
  // [changmen 扩展] 兼容旧单的财务证明；费用缺失或未知不阻止新订单发送。
  if (fee?.exponent === 1 && fee.takerOnly === true && typeof fee.rate === "string"
    && /^\d+(?:\.\d{1,6})?$/.test(fee.rate) && Number.isFinite(fee.observedAt) && fee.observedAt > 0) {
    plan.feeProof = { rate: fee.rate, exponent: fee.exponent, takerOnly: fee.takerOnly, observedAt: fee.observedAt };
  }
  if (!plan || !["A", "B"].includes(plan.originalPmLeg) || !["Home", "Away"].includes(plan.target)
    || !["Home", "Away"].includes(plan.otherTarget) || ![2, 3].includes(plan.protocol)
    || !/^0x[0-9a-f]{64}$/i.test(plan.orderHash)) {
    throw new Error("GTC 计划无效");
  }
  for (const key of ["price", "shares", "targetShares", "maxPrincipal", "allInBudget"] as const) {
    if (gtcUnits(plan[key]) <= 0n)
      throw new Error("GTC 定量/预算无效");
  }
  if (gtcUnits(plan.price) >= 1000000n || !(plan.fx > 0) || (!manual && (!(plan.otherOdds > 1) || !(plan.otherStake > 0)))
    || !Number.isFinite(plan.fx) || !Number.isFinite(plan.otherStake)) {
    throw new Error("GTC 价格/另一腿参数无效");
  }
  if (gtcUnits(plan.shares) > gtcUnits(plan.targetShares) || gtcUnits(plan.maxPrincipal) > gtcUnits(plan.allInBudget)
    || typeof plan.parallel !== "boolean" || typeof plan.negRisk !== "boolean"
    || !Number.isFinite(plan.otherOdds)) {
    throw new Error("GTC 预算或执行参数无效");
  }
  for (const playerId of manual ? [plan.playerId] : [plan.playerId, plan.otherPlayerId]) {
    if (!Number.isSafeInteger(playerId) || playerId <= 0) throw new Error("GTC 账号 ID 无效或超出安全范围");
  }
  return plan;
}

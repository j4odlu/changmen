import type { BetOption } from "@changmen/client-core/models/betOption";

/** PM 是否参与本组套利腿（用于其它模块门控；预检与 A8 相同为并行 2 次） */
export function arbLegsIncludePolymarket(legA: BetOption, legB: BetOption): boolean {
  return legA.type === "Polymarket" || legB.type === "Polymarket";
}

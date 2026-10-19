import type { ArbOpportunity, OpportunityKey } from "./types";
import { indexOpportunities } from "./detect";

export type OpportunityTransition
  = | { kind: "appeared"; opportunity: ArbOpportunity }
    | { kind: "gone"; key: OpportunityKey; previous: ArbOpportunity };

/** 上一拍快照 → 当前列表，产出 appeared / gone（持续存在且利润微变不重报） */
export function diffOpportunities(
  previous: Map<OpportunityKey, ArbOpportunity>,
  current: ArbOpportunity[],
): OpportunityTransition[] {
  const next = indexOpportunities(current);
  const transitions: OpportunityTransition[] = [];

  for (const [key, opportunity] of next) {
    if (!previous.has(key)) {
      transitions.push({ kind: "appeared", opportunity });
    }
  }

  for (const [key, prev] of previous) {
    if (!next.has(key)) {
      transitions.push({ kind: "gone", key, previous: prev });
    }
  }

  return transitions;
}

/** loop 处理完 transitions 后，用当前 detect 结果覆盖快照 */
export function snapshotOpportunities(
  opportunities: ArbOpportunity[],
): Map<OpportunityKey, ArbOpportunity> {
  return indexOpportunities(opportunities);
}

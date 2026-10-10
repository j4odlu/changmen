import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import type { ActiveBetLeg, ActiveBetRun } from "@/types/activeBetRun";
import type { ProgressComparisonGroup } from "./activeBetRunComparison";
import { activeBetLegAttemptViews } from "./activeBetRunStages";

function eventStage(event: OrderObservationEvent): string {
  if (event.source === "ray_monitor") return "ray_monitor";
  if (event.kind.startsWith("precheck_")) return "precheck";
  if (event.kind.startsWith("submission_")) return "submission";
  if (event.kind === "bind_result") return "binding";
  if (event.kind === "settlement_observed" || event.reasonCode === "reject_detection_started") return "confirmation";
  if (event.kind.startsWith("queue_")) return "makeup";
  if (event.kind === "decision") return "submission";
  return "result";
}

/** [changmen 扩展] 时间线只补充现有阶段，不改阶段结果；每条事实保留在本腿、本次尝试中。 */
export function activeBetRunComparisonTimeline(run: ActiveBetRun, facts: ReadonlyMap<ActiveBetLeg["side"], readonly OrderObservationEvent[]>, groups: readonly ProgressComparisonGroup[]) {
  const timelines = new Map<string, Map<string, Map<ActiveBetLeg["side"], OrderObservationEvent[]>>>();
  for (const group of groups)
    timelines.set(group.key, new Map(group.rows.map(row => [row.id, new Map()])));
  for (const leg of run.legs) {
    const events = facts.get(leg.side) || [];
    const attempts = new Map(activeBetLegAttemptViews(run, leg, events).attempts.map(attempt => [attempt.id, attempt.key]));
    for (const event of events) {
      const stage = eventStage(event);
      const key = stage === "makeup" || stage === "result" ? "orchestration"
        : timelines.has("current") ? "current" : event.attemptId ? attempts.get(event.attemptId) : undefined;
      // 缺少尝试归属或对应阶段时完整保留在本腿编排记录，不借用其他轮的结果。
      const rows = key ? timelines.get(key) : undefined;
      const sides = rows?.get(stage) || timelines.get("orchestration")!.get("result")!;
      const feed = sides.get(leg.side) || [];
      feed.push(event);
      sides.set(leg.side, feed);
    }
  }
  return timelines;
}

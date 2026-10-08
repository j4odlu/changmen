import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import type { ActiveBetLeg, ActiveBetRun } from "@/types/activeBetRun";
import type { OrderRow } from "@/types/order";
import type { BetProgressStage } from "./activeBetRunStages";
import { activeBetLegAttemptViews, activeBetLegStages } from "./activeBetRunStages";
import { progressProof } from "@changmen/shared/order_progress_evidence";

const STAGES = [
  ["precheck", "预检"], ["submission", "提交下注"], ["binding", "绑定订单"],
  ["confirmation", "场馆确认 / 拒单检测"], ["ray_monitor", "RAY订单监控"],
  ["makeup", "补单队列"], ["result", "编排收尾"],
] as const;

export interface ProgressComparisonGroup {
  key: string;
  label: string;
  providers: (string | undefined)[];
  rows: { id: string; stage: string; cells: BetProgressStage[] }[];
}

/** [changmen 扩展] 按同类尝试的轮次和阶段横向对齐；单腿补单不借用对腿首轮结果。 */
export function activeBetRunComparison(run: ActiveBetRun, facts: ReadonlyMap<ActiveBetLeg["side"], readonly OrderObservationEvent[]>, orders: readonly OrderRow[] = [], executionEvents: readonly OrderObservationEvent[] = []): ProgressComparisonGroup[] {
  const legs = [...run.legs].sort((a, b) => a.side.localeCompare(b.side));
  const views = legs.map(leg => activeBetLegAttemptViews(run, leg, facts.get(leg.side) || []));
  const definitions = new Map<string, string>();
  for (const view of views) {
    for (const attempt of view.attempts)
      definitions.set(attempt.key, attempt.label);
  }
  const groups: ProgressComparisonGroup[] = [];
  function build(key: string, label: string, stages: (BetProgressStage[] | undefined)[], providers: (string | undefined)[], ids: readonly string[]) {
    const rows = STAGES.filter(([id]) => ids.includes(id) && stages.some(side => side?.some(stage => stage.id === id)))
      .map(([id, stage]) => ({ id, stage, cells: stages.map(side => side?.find(item => item.id === id) || {
        id, stage,
        label: side ? "不适用" : "本腿无此轮尝试", tone: "neutral" as const,
      }) }));
    groups.push({ key, label, providers, rows });
  }
  const order = (key: string) => ["initial", "retry", "makeup", "unknown"].indexOf(key.split(":")[0]!);
  const keys = [...definitions.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b, undefined, { numeric: true }));
  for (const key of keys) {
    const providers: (string | undefined)[] = [];
    const stages = legs.map((leg, index) => {
      const attempt = views[index]!.attempts.find(item => item.key === key);
      providers.push(attempt?.provider);
      if (!attempt) return undefined;
      const events = (facts.get(leg.side) || []).filter(event => event.attemptId === attempt.id);
      const latest = attempt.id === views[index]!.attempts.at(-1)?.id;
      const rows = activeBetLegStages(run, latest ? leg : { ...leg, status: "pending", events: [] }, events, orders, executionEvents);
      const matched = events.find(event => event.kind === "submission_result" && event.provider === "Polymarket" && event.outcome === "accepted" && event.observedStatus === "matched");
      if (matched) rows.push({ id: "confirmation", stage: "成交确认", label: "直接成交 · 无需拒单检测", tone: "success", at: matched.occurredAt,
        proof: progressProof("pm.direct_matched", [matched]) });
      return rows;
    });
    build(key, definitions.get(key)!, stages, providers, STAGES.slice(0, 5).map(([id]) => id));
  }
  const current = legs.map(leg => activeBetLegStages(run, leg, facts.get(leg.side) || [], orders, executionEvents));
  if (!keys.length) build("current", "当前进度", current, legs.map(leg => leg.platform), STAGES.slice(0, 5).map(([id]) => id));
  build("orchestration", "补单与编排", current, [], ["makeup", "result"]);
  return groups;
}

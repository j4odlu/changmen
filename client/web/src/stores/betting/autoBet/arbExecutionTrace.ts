import type { ArbProgressPolymarketMeta } from "@/types/arbProgress";
import type { ViewBet, ViewMatch } from "@/models/match";
import { arbProfitRate } from "@changmen/client-core/shared/format";

/** [changmen 扩展] 套利执行进度追踪结果 */
export type ArbProgressOutcome = "success" | "partial" | "fail" | "skip";

export type { ArbProgressPolymarketMeta } from "@/types/arbProgress";

export interface ArbProgressLegPrecheck {
  ok: boolean;
  error?: string;
  polymarket?: ArbProgressPolymarketMeta;
}

export interface ArbProgressLegMeta {
  side: "A" | "B";
  platform: string;
  target: string;
  odds: number;
  betMoney: number;
  /** GetOrderOptions 计划额（CNY）；预检后 betMoney 可能为 PM USDC */
  planBetMoney?: number;
  planOdds?: number;
  account?: string;
  precheck?: ArbProgressLegPrecheck;
}

export interface ArbProgressEvent {
  at: number;
  stage: string;
  detail: string;
}

export interface ArbProgressPayload {
  id: string;
  matchId: number;
  betId: number;
  matchTitle: string;
  betName: string;
  startedAt: number;
  events: ArbProgressEvent[];
  outcome: ArbProgressOutcome;
  summary: string;
  meta?: {
    implied?: number;
    homeLine?: string;
    awayLine?: string;
    legs?: ArbProgressLegMeta[];
  };
}

export interface ArbExecutionTrace {
  readonly id: string;
  event: (stage: string, detail: string) => void;
  getMeta: () => ArbProgressPayload["meta"] | undefined;
  setMeta: (meta: ArbProgressPayload["meta"]) => void;
  finish: (outcome: ArbProgressOutcome, summary?: string) => void;
}

export function createArbExecutionTrace(
  match: ViewMatch,
  bet: ViewBet,
  meta?: ArbProgressPayload["meta"],
  deliver?: (payload: ArbProgressPayload) => void,
): ArbExecutionTrace {
  const events: ArbProgressEvent[] = [];
  const startedAt = Date.now();
  const id = `${match.id}:${bet.id}:${startedAt}`;
  let finished = false;
  let metaRef = meta;

  const trace: ArbExecutionTrace = {
    id,
    event(stage, detail) {
      if (finished)
        return;
      events.push({ at: Date.now(), stage, detail });
    },
    getMeta() {
      return metaRef;
    },
    setMeta(next) {
      if (finished)
        return;
      metaRef = { ...metaRef, ...next };
      if (next?.implied != null && !events.some(e => e.stage === "发现")) {
        events.push({
          at: Date.now(),
          stage: "发现",
          detail: `利润 ${arbProfitRate(next.implied)}`,
        });
      }
    },
    finish(outcome, summary = "") {
      if (finished)
        return;
      finished = true;
      deliver?.({
        id,
        matchId: match.id,
        betId: bet.id,
        matchTitle: match.title,
        betName: bet.getBetName(),
        startedAt,
        events: [...events],
        outcome,
        summary,
        meta: metaRef,
      });
    },
  };

  if (metaRef?.implied != null) {
    trace.event("发现", `利润 ${arbProfitRate(metaRef.implied)}`);
  }
  return trace;
}

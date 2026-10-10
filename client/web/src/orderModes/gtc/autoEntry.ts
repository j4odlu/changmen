import type { ObservationContext } from "@changmen/shared/order_observation";
import type { ViewBet, ViewMatch } from "@/models/match";
import type { ArbAttemptPhase } from "@/stores/betting/autoBet/arbAttemptMetrics";
import type { ArbBetAttemptParams, ArbBetReady } from "@/stores/betting/autoBet/phases/types";
import type { UserConfig } from "@/types/userConfig";
import { isMapMuteActive } from "@/extensions/mapBetMute";
import { isPrematchFullMarketAllowed } from "@/extensions/prematchFullOnly";
import { ExecutionError } from "@/orderModes/gtc/executionResult";
import { beginExecutionObservation, finishExecutionObservation } from "@/services/orderExecutionObservation";
import {
  recordArbAttemptMetric,
} from "@/stores/betting/autoBet/arbAttemptMetrics";
import { checkArbLegs } from "./check";
import { executeGtc } from "./execute";
import { prepareArbAttempt } from "./prepare";
import { presentArbExecution } from "./presentation";

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const startedAt = performance.now();
  const value = await run();
  return { value, ms: Math.round(performance.now() - startedAt) };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 单场单 bet 行的自动套利执行（选号 → 预检 → 下单 → 拒单/绑单/补单/收尾） */
export async function executeGtcAttempt(params: {
  match: ViewMatch;
  bet: ViewBet;
  config: UserConfig;
  setMessage: (msg: string) => void;
}): Promise<void> {
  // [changmen 扩展] 赛前全场过滤：关则恒放行；开则只留下未开赛全场
  if (!isPrematchFullMarketAllowed(params.match, params.bet))
    return;
  // [changmen 扩展] 用户折叠的全场 / 地图：跳过本盘（live 局互斥，不跳过）
  if (isMapMuteActive(params.match.id, params.bet.round, params.match.liveRound))
    return;

  const attempt: ArbBetAttemptParams = { ...params };

  const phaseMsMap: Partial<Record<ArbAttemptPhase, number>> = {};
  const base = { at: Date.now(), matchId: params.match.id, betId: params.bet.id };
  let ready: ArbBetReady | null = null;
  let phase: ArbAttemptPhase | "idle" = "idle";
  let observation: ObservationContext | undefined;
  let observationOutcome = "unknown";
  let observationMessage: unknown;

  try {
    phase = "prepare";
    const prepared = await timed(() => prepareArbAttempt(attempt));
    phaseMsMap.prepare = prepared.ms;
    ready = prepared.value;
    if (!ready) {
      recordArbAttemptMetric({ ...base, phaseMs: phaseMsMap, stop: "skip_prepare" });
      return;
    }
    const readyValue = ready;
    observation = beginExecutionObservation(readyValue);

    phase = "check";
    const checked = await timed(() => checkArbLegs(attempt, readyValue));
    phaseMsMap.check = checked.ms;
    const checkedValue = checked.value;
    if (!checkedValue) {
      observationOutcome = "blocked";
      recordArbAttemptMetric({ ...base, phaseMs: phaseMsMap, stop: "skip_check" });
      return;
    }

    // GTC owns submission, original-order confirmation and closing its send window.
    phase = "place";
    const executed = await timed(() => executeGtc(attempt, checkedValue));
    phaseMsMap.place = executed.ms;
    presentArbExecution(attempt, executed.value);
    observationOutcome = executed.value.observationOutcome;
    recordArbAttemptMetric({ ...base, phaseMs: phaseMsMap, stop: "complete" });
  }
  catch (err) {
    if (err instanceof ExecutionError && err.result.executionKind === "pm-gtc-v1")
      presentArbExecution(attempt, err.result);
    observationOutcome = "exception";
    observationMessage = err instanceof Error ? err.message : "";
    const msg = errorMessage(err);
    params.setMessage(`自动下单异常：${msg}`);
    attempt.trace?.finish("fail", msg);
    recordArbAttemptMetric({ ...base, phaseMs: phaseMsMap, stop: "error" });
  }
  finally {
    finishExecutionObservation(observation, ready?.linkId, observationOutcome, phase, observationMessage);
  }
}

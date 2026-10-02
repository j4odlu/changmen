import type { ObservationContext } from "@changmen/shared/order_observation";
import type { ViewBet, ViewMatch } from "@/models/match";
import type { ArbAttemptPhase } from "@/stores/betting/autoBet/arbAttemptMetrics";
import type { ArbBetAttemptParams, ArbBetReady } from "@/stores/betting/autoBet/phases/types";
import type { UserConfig } from "@/types/userConfig";
import {
  releaseSingleLeg9999MapFill,
  releaseSingleLeg9999MapFillKeys,
} from "@/extensions/arbBet/singleLeg9999MapCount";
import { isMapMuteActive } from "@/extensions/mapBetMute";
import { isPrematchFullMarketAllowed } from "@/extensions/prematchFullOnly";
import { beginExecutionObservation, finishExecutionObservation } from "@/services/orderExecutionObservation";
import {
  recordArbAttemptMetric,
} from "@/stores/betting/autoBet/arbAttemptMetrics";
import { checkArbLegs } from "@/stores/betting/autoBet/phases/checkArbLegs";
import { finalizeArbBet } from "@/stores/betting/autoBet/phases/finalizeArbBet";
import { placeArbLegs } from "@/stores/betting/autoBet/phases/placeArbLegs";
import { prepareArbAttempt } from "@/stores/betting/autoBet/phases/prepareArbAttempt";

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const startedAt = performance.now();
  const value = await run();
  return { value, ms: Math.round(performance.now() - startedAt) };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function releaseSingleLeg9999Reservation(matchId: number, round: number, ready: ArbBetReady): void {
  if (!ready.singleLeg9999MapReserved)
    return;
  if (ready.singleLeg9999MapKeys?.length)
    releaseSingleLeg9999MapFillKeys(ready.singleLeg9999MapKeys);
  else releaseSingleLeg9999MapFill(matchId, round);
}

/** 单场单 bet 行的自动套利执行（选号 → 预检 → 下单 → 拒单/绑单/补单/收尾） */
export async function executeArbBet(params: {
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
  let reservationReleased = false;
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
      releaseSingleLeg9999Reservation(params.match.id, params.bet.round, readyValue);
      reservationReleased = true;
      recordArbAttemptMetric({ ...base, phaseMs: phaseMsMap, stop: "skip_check" });
      return;
    }

    // 预检通过后：place 必回传两腿结果，编排层 finalize 必跑（场馆 settle 仍只处理 API 成功腿）
    phase = "place";
    const placed = await timed(() => placeArbLegs(attempt, checkedValue));
    phaseMsMap.place = placed.ms;

    phase = "finalize";
    const finalized = await timed(() => finalizeArbBet(attempt, placed.value));
    phaseMsMap.finalize = finalized.ms;
    recordArbAttemptMetric({ ...base, phaseMs: phaseMsMap, stop: "complete" });
    observationOutcome = "orchestration_completed";
  }
  catch (err) {
    observationOutcome = "exception";
    observationMessage = err instanceof Error ? err.message : "";
    if (ready && !reservationReleased && phase === "check") {
      releaseSingleLeg9999Reservation(params.match.id, params.bet.round, ready);
      reservationReleased = true;
    }
    const msg = errorMessage(err);
    params.setMessage(`自动下单异常：${msg}`);
    attempt.trace?.finish("fail", msg);
    recordArbAttemptMetric({ ...base, phaseMs: phaseMsMap, stop: "error" });
  }
  finally {
    finishExecutionObservation(observation, ready?.linkId, observationOutcome, phase, observationMessage);
  }
}

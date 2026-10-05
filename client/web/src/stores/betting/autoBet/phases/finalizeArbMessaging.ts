import type { ArbExecutionTrace } from "@/stores/betting/autoBet/arbExecutionTrace";
import type { ArbBetAttemptParams, ArbBetPlaced } from "@/stores/betting/autoBet/phases/types";
import type { ArbFinalizeOutcome } from "@/stores/betting/autoBet/phases/syncArbFinalizeUi";
import type { ArbLegSettleSnapshot } from "@/stores/betting/autoBet/phases/settleBothArbLegs";
import type { ArbMakeUpEnqueueResult } from "@/stores/betting/autoBet/arbMakeUpFromRejects";
import type { BettingMessageLeg, BettingMessageSingleLegRatePeer } from "@/stores/messageStore";
import { findSingleLegRateAccount } from "@/domain/betting/singleLegRate";
import { opponentSide } from "@changmen/client-core/models/betOption";
import {
  syncActiveBetBindFailed,
  syncActiveBetBindSuccess,
} from "@/stores/betting/activeBetRunSync";
import { readUsedAccounts } from "@/stores/betting/successMarkers";
import { useAccountStore } from "@/stores/accountStore";
import { useMatchStore } from "@/stores/matchStore";
import { useMessageStore } from "@/stores/messageStore";

function singleLegRatePeer(
  params: ArbBetAttemptParams,
  placed: ArbBetPlaced,
): BettingMessageSingleLegRatePeer | null {
  const { match, bet, config } = params;
  const { legA, legB, accountA, accountB } = placed;
  const matchStore = useMatchStore();
  const accountStore = useAccountStore();

  if (accountA && accountB)
    return null;

  const skippedLeg = accountA ? legB : legA;
  const exclude = config.noSameBet
    ? readUsedAccounts(bet.id, opponentSide(skippedLeg.target))
    : [];
  const rateAccount = findSingleLegRateAccount(
    skippedLeg,
    bet,
    match,
    accountStore.accounts,
    exclude,
    matchStore,
    placed.implied,
  );
  const platformLabel
    = rateAccount?.platformName
      || rateAccount?.provider
      || skippedLeg.type;
  return {
    kind: "singleLegRate",
    options: skippedLeg,
    platformLabel,
  };
}

export function buildBettingMessagePeers(
  params: ArbBetAttemptParams,
  placed: ArbBetPlaced,
  rejectA: boolean,
  rejectB: boolean,
): [BettingMessageLeg | BettingMessageSingleLegRatePeer, BettingMessageLeg | BettingMessageSingleLegRatePeer] | null {
  const { legA, legB, accountA, accountB, resultA, resultB, betBothLegs } = placed;
  if (!resultA && !resultB)
    return null;
  if (!(resultA?.success || resultB?.success))
    return null;

  if (betBothLegs && accountA && accountB && resultA && resultB) {
    return [
      { account: accountA, result: resultA, options: legA, reject: rejectA },
      { account: accountB, result: resultB, options: legB, reject: rejectB },
    ];
  }

  const skipped = singleLegRatePeer(params, placed);
  if (!skipped)
    return null;

  if (accountA && resultA?.success) {
    return [
      { account: accountA, result: resultA, options: legA, reject: rejectA },
      skipped,
    ];
  }
  if (accountB && resultB?.success) {
    return [
      skipped,
      { account: accountB, result: resultB, options: legB, reject: rejectB },
    ];
  }
  return null;
}

export function logArbFinalizeTraceEvents(
  trace: ArbExecutionTrace | undefined,
  linkId: number,
  placed: ArbBetPlaced,
  settle: ArbLegSettleSnapshot,
  makeup: ArbMakeUpEnqueueResult,
  betId?: number,
): void {
  const { legA, legB } = placed;
  if (settle.boundLegLabels.length) {
    trace?.event("绑单", `linkId ${linkId} · ${settle.boundLegLabels.join(" + ")}`);
    if (betId != null) {
      const okSides: Array<"A" | "B"> = [];
      if (settle.boundLegLabels.includes(legA.type))
        okSides.push("A");
      if (settle.boundLegLabels.includes(legB.type))
        okSides.push("B");
      if (okSides.length)
        syncActiveBetBindSuccess(betId, okSides, "已绑单");
    }
  }
  if (settle.bindFailedLegLabels.length) {
    // 已入补绑队列；耗尽后由 processPendingOrderBinds 再标「补绑耗尽」
    const failDetail = `绑单失败，将补绑 · ${settle.bindFailedLegLabels.join(" + ")}`;
    trace?.event("绑单", failDetail);
    if (betId != null && settle.bindFailedSides.length)
      syncActiveBetBindFailed(betId, settle.bindFailedSides, failDetail);
  }
  if (makeup.enqueuedForLegB)
    trace?.event("补单", `已入队 ${legB.type} ${legB.target}`);
  if (makeup.enqueuedForLegA)
    trace?.event("补单", `已入队 ${legA.type} ${legA.target}`);
}

export function finishArbExecutionTrace(
  params: ArbBetAttemptParams,
  placed: ArbBetPlaced,
  settle: ArbLegSettleSnapshot,
  outcome: ArbFinalizeOutcome,
): void {
  const { trace } = params;
  const { legA, legB, resultA, resultB } = placed;
  const { okA, okB, makeupQueued } = outcome;

  if (okA && okB) {
    trace?.finish("success", "双腿成单");
    return;
  }
  if (resultA?.success || resultB?.success) {
    const parts = [
      okA ? `${legA.type} 成` : null,
      okB ? `${legB.type} 成` : null,
      settle.rejectA || settle.rejectB ? "含拒单" : null,
      makeupQueued ? "已入补单" : null,
    ].filter(Boolean);
    trace?.finish("partial", parts.join(" · ") || "部分成功");
    return;
  }
  // UI 已由 syncArbFinalizeActiveBet 标「未成单」；此处只收尾 trace，避免覆盖
  const anyAttempted
    = placed.placeOutcomeA !== "not_attempted"
      || placed.placeOutcomeB !== "not_attempted";
  trace?.finish("fail", anyAttempted ? "下单未成功" : "收尾无成功腿");
}

export function sendArbBettingMessageIfNeeded(
  params: ArbBetAttemptParams,
  placed: ArbBetPlaced,
  settle: ArbLegSettleSnapshot,
): void {
  const messagePeers = buildBettingMessagePeers(
    params,
    placed,
    settle.rejectA,
    settle.rejectB,
  );
  // [A8 可证实] 成功腿收尾始终发送下单提醒；[changmen 扩展] 进度报告只作辅助。
  if (messagePeers)
    useMessageStore().bettingMessage(messagePeers[0], messagePeers[1], placed.linkId);
}

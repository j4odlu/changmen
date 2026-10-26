import { claimLowOddsMarket } from "@/extensions/arbBet/lowOddsSingle";
import { recordPmExecutionMetric } from "@changmen/venue-browser/adapter/polymarket";
import { validatePolymarketPreparedBuy } from "@changmen/venue-browser/adapter/polymarket";
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@/models/platformAccount";
import type {
  ArbBetAttemptParams,
  ArbBetChecked,
  ArbBetPlaced,
  ArbLegPlaceOutcome,
} from "@/stores/betting/autoBet/phases/types";
import { isPendingConfirmVenueProvider } from "@changmen/shared/account_multiply";
import { observeArbSubmissionBlocked } from "@/services/orderExecutionObservation";
import { formatBetResult } from "@/shared/arbBetTraceFormat";
import { useAccountStore } from "@/stores/accountStore";
import {
  syncActiveBetLeg,
  syncActiveBetPhase,
  syncActiveBetPlaceResults,
} from "@/stores/betting/activeBetRunSync";
import { resolveArbLegPlaceOutcome } from "@/stores/betting/autoBet/phases/types";
import { retryFailedLeg } from "@/stores/betting/autoBet/retryFailedLeg";

/** [A8 可证实] 仅用户选 Parallel 时走并发 POST；不按场馆类型另开编排分支。 */
export function shouldPlaceLegsInParallel(
  betSorting: string | undefined,
): boolean {
  return betSorting === "Parallel";
}

function buildPlaced(
  checked: ArbBetChecked,
  legA: BetOption,
  legB: BetOption,
  accountA: PlatformAccount | undefined,
  accountB: PlatformAccount | undefined,
  resultA: BetResult | undefined,
  resultB: BetResult | undefined,
  placeOutcomeA: ArbLegPlaceOutcome,
  placeOutcomeB: ArbLegPlaceOutcome,
): ArbBetPlaced {
  return {
    ...checked,
    legA,
    legB,
    accountA,
    accountB,
    resultA,
    resultB,
    placeOutcomeA,
    placeOutcomeB,
  };
}

function hasPlaceQuote(option: BetOption): boolean {
  return option.data != null;
}

/**
 * 下单 + anyOdds 换腿重试。
 * 预检通过后始终回传双侧 place 结果给编排层（finalize）；不在此 trace.finish / abort。
 * 场馆拒单判定不在本层。
 */
export async function placeArbLegs(
  params: ArbBetAttemptParams,
  checked: ArbBetChecked,
): Promise<ArbBetPlaced> {
  const { match, bet, config, trace } = params;
  const accountStore = useAccountStore();
  let { legA, legB, accountA, accountB, betBothLegs, waitSec, linkId } = checked;
  const placeOpts = { linkId, requirePreparedQuote: true };
  const dispatchStart = checked.precheckCompletedAt ?? performance.now();
  const hasPm = [legA.type, legB.type].includes("Polymarket");
  const lowOddsSingle = checked.executionMode === "lowOddsSingle";
  function submitLeg(account: PlatformAccount, leg: BetOption) {
    if (hasPm) recordPmExecutionMetric({ kind: "dispatch", tokenId: leg.itemId,
      stage: leg.type, linkId, ms: performance.now() - dispatchStart, success: true });
    return accountStore.betting(account, leg, waitSec, placeOpts);
  }

  if (isPendingConfirmVenueProvider(legA.type))
    legA.deferPostAcceptSettlement = true;
  if (isPendingConfirmVenueProvider(legB.type))
    legB.deferPostAcceptSettlement = true;

  syncActiveBetPhase(bet.id, "placing", "提交场馆订单");

  let resultA: BetResult | undefined;
  let resultB: BetResult | undefined;
  let attemptedA = false;
  let attemptedB = false;

  if (accountA)
    syncActiveBetLeg(bet.id, "A", "placing");
  if (accountB)
    syncActiveBetLeg(bet.id, "B", "placing");

  let mixedBlocked = false;
  let mixedBlockReason = "";
  for (const [account, leg] of [[accountA, legA], [accountB, legB]] as const) {
    if (account?.provider !== "Polymarket") continue;
    const reason = validatePolymarketPreparedBuy(account, leg);
    if (reason) { mixedBlocked = true; mixedBlockReason = reason; trace?.event("预检", reason); }
  }
  if (betBothLegs && accountA && accountB && (!hasPlaceQuote(legA) || !hasPlaceQuote(legB))) {
    mixedBlockReason = "双侧预检未齐，不提交订单";
    trace?.event("预检", mixedBlockReason);
    mixedBlocked = true;
  }
  if (lowOddsSingle) {
    const validSingle = !betBothLegs && checked.executionSide
      && Boolean(accountA) !== Boolean(accountB)
      && (checked.executionSide === "A" ? Boolean(accountA) : Boolean(accountB))
      && checked.checkAccountA && checked.checkAccountB && legA.data && legB.data
      && !legA.checkError && !legB.checkError;
    if (!validSingle) { mixedBlocked = true; mixedBlockReason = "🎯 双预检或单腿执行计划不完整，未提交"; }
    if (!mixedBlocked) {
      try {
        if (!await claimLowOddsMarket(checked.lowOddsMarketKeys ?? [])) {
          mixedBlocked = true; mixedBlockReason = "🎯 本盘口已提交过，跳过";
        }
      }
      catch (error) {
        mixedBlocked = true; mixedBlockReason = error instanceof Error ? error.message : "🎯 盘口次数占位失败，未提交";
      }
    }
    syncActiveBetLeg(bet.id, checked.executionSide === "A" ? "B" : "A", "skipped", "🎯 高赔腿主动跳过，不补单");
    trace?.event("模式", "🎯 LOS：高赔腿主动跳过，不补单");
  }
  if (mixedBlocked)
    observeArbSubmissionBlocked(checked, "pair_submit_blocked", mixedBlockReason);

  if (!mixedBlocked && !betBothLegs) {
    if (accountA) {
      trace?.event("下单", `开始 ${legA.type} ${legA.target}`);
      attemptedA = true;
      resultA = await submitLeg(accountA, legA);
    }
    else {
      trace?.event("下单", `开始 ${legB.type} ${legB.target}`);
      attemptedB = true;
      resultB = await submitLeg(accountB!, legB);
    }
  }
  else if (!mixedBlocked && shouldPlaceLegsInParallel(config.betSorting)) {
    trace?.event("下单", `并行 ${legA.type} + ${legB.type}`);
    attemptedA = true;
    attemptedB = true;
    const tasks = [
      submitLeg(accountA!, legA),
      submitLeg(accountB!, legB),
    ];
    const pair = await Promise.all(tasks);
    resultA = pair[0];
    resultB = pair[1];
    if (resultA?.success || !pair.some(r => r?.success)) {
      // keep leg/account assignment
    }
    else if (resultB?.success) {
      [legA, legB] = [legB, legA];
      [accountA, accountB] = [accountB, accountA];
      resultA = pair[1];
      resultB = pair[0];
    }
  }
  else if (!mixedBlocked) {
    trace?.event("下单", `顺序 ${legA.type} → ${legB.type}`);
    attemptedA = true;
    const firstStart = performance.now();
    resultA = await submitLeg(accountA!, legA);
    if (hasPm) recordPmExecutionMetric({ kind: "serial_wait", linkId, ms: performance.now() - firstStart, success: resultA.success });
    if (resultA.success) {
      attemptedB = true;
      resultB = await submitLeg(accountB!, legB);
    }
    else {
      // [changmen 扩展] 首腿未成功时 A8 不发第二腿；单独记录第二腿未提交，不覆盖首腿回执。
      const reason = resultA.pmSubmitUnknown ? "首腿提交结果未知，未发送第二腿" : "首腿提交返回失败，未发送第二腿";
      observeArbSubmissionBlocked({ ...checked, accountA: undefined }, "serial_first_leg_failed", reason);
    }
    // A 失败：B 保持 not_attempted，仍回传编排层
  }

  if (!lowOddsSingle && resultB?.success && !resultA?.success) {
    [legA, legB] = [legB, legA];
    [accountA, accountB] = [accountB, accountA];
    [resultA, resultB] = [resultB, resultA];
    [attemptedA, attemptedB] = [attemptedB, attemptedA];
  }

  trace?.event(
    "下单",
    [
      accountA || attemptedA
        ? formatBetResult(legA.type, legA.target, legA.betMoney, legA.odds, resultA)
        : `${legA.type} ${legA.target} 未下单`,
      accountB || attemptedB
        ? formatBetResult(legB.type, legB.target, legB.betMoney, legB.odds, resultB)
        : `${legB.type} ${legB.target} 未下单`,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  if (betBothLegs && resultA?.success && !resultB?.success && !resultB?.pmSubmitUnknown && attemptedB) {
    trace?.event("重试", `anyOdds 换腿补 ${legB.type} ${legB.target}`);
    const retry = await retryFailedLeg(
      match,
      bet,
      legA,
      legB,
      accountA,
      config,
      waitSec,
      trace,
      linkId,
    );
    if (retry) {
      resultB = retry.result;
      legB = retry.leg;
      accountB = retry.account;
      attemptedB = true;
      trace?.event(
        "重试",
        formatBetResult(legB.type, legB.target, legB.betMoney, legB.odds, resultB),
      );
    }
    else {
      trace?.event("重试", "换腿未成功");
      // [A8 可证实] 拒单检测结束后才由 finalize 决定入队；此处只保留即时换馆重试。
    }
  }

  const placeOutcomeA = resolveArbLegPlaceOutcome(attemptedA, resultA);
  const placeOutcomeB = resolveArbLegPlaceOutcome(attemptedB, resultB);

  syncActiveBetPlaceResults(
    bet.id,
    resultA,
    resultB,
    Boolean(accountA),
    Boolean(accountB),
    placeOutcomeA,
    placeOutcomeB,
    mixedBlocked ? mixedBlockReason || undefined : undefined,
  );

  return buildPlaced(
    checked,
    legA,
    legB,
    accountA,
    accountB,
    resultA,
    resultB,
    placeOutcomeA,
    placeOutcomeB,
  );
}

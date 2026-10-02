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
import { legStakeCny } from "@/domain/polymarket/pmArbStake";
import { formatBetResult } from "@/shared/arbBetTraceFormat";
import { useAccountStore } from "@/stores/accountStore";
import {
  syncActiveBetLeg,
  syncActiveBetPhase,
  syncActiveBetPlaceResults,
} from "@/stores/betting/activeBetRunSync";
import { enqueueMakeUpOrder } from "@/stores/betting/autoBet/makeUp";
import { resolveArbLegPlaceOutcome } from "@/stores/betting/autoBet/phases/types";
import { retryFailedLeg } from "@/stores/betting/autoBet/retryFailedLeg";
import { useLoseOrderStore } from "@/stores/loseOrderStore";

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
  const { match, bet, config, trace, setMessage } = params;
  const accountStore = useAccountStore();
  let { legA, legB, accountA, accountB, betBothLegs, waitSec, linkId } = checked;
  const placeOpts = { linkId, requirePreparedQuote: true };

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
  if (betBothLegs && accountA && accountB && (!hasPlaceQuote(legA) || !hasPlaceQuote(legB))) {
    mixedBlockReason = "双侧预检未齐，取消下单";
    trace?.event("预检", mixedBlockReason);
    mixedBlocked = true;
  }

  if (!mixedBlocked && !betBothLegs) {
    if (accountA) {
      trace?.event("下单", `开始 ${legA.type} ${legA.target}`);
      attemptedA = true;
      resultA = await accountStore.betting(accountA, legA, waitSec, placeOpts);
    }
    else {
      trace?.event("下单", `开始 ${legB.type} ${legB.target}`);
      attemptedB = true;
      resultB = await accountStore.betting(accountB!, legB, waitSec, placeOpts);
    }
  }
  else if (!mixedBlocked && shouldPlaceLegsInParallel(config.betSorting)) {
    trace?.event("下单", `并行 ${legA.type} + ${legB.type}`);
    attemptedA = true;
    attemptedB = true;
    const pair = await Promise.all([
      accountStore.betting(accountA!, legA, waitSec, placeOpts),
      accountStore.betting(accountB!, legB, waitSec, placeOpts),
    ]);
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
    resultA = await accountStore.betting(accountA!, legA, waitSec, placeOpts);
    if (resultA.success) {
      attemptedB = true;
      resultB = await accountStore.betting(accountB!, legB, waitSec, placeOpts);
    }
    // A 失败：B 保持 not_attempted，仍回传编排层
  }

  if (resultB?.success && !resultA?.success) {
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

  if (betBothLegs && resultA?.success && !resultB?.success && attemptedB) {
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
      const anchorPlaceOutcome = resolveArbLegPlaceOutcome(attemptedA, resultA);
      if (anchorPlaceOutcome === "accepted_pending_confirm") {
        // PM delayed / PF OPEN 与传统场馆拒单检测中的语义一致：尚未确认成交，
        // 可以保留 A8 即时换腿重试，但不能作为普通补单的成功锚腿。
        trace?.event("补单", `${legA.type} 结果确认中，暂不进入补单队列`);
      }
      else if (accountA) {
        const enqueued = await enqueueMakeUpOrder({
          loseStore: useLoseOrderStore(),
          match,
          bet,
          config,
          setMessage,
          linkId,
          accountId: accountA.accountId,
          target: legB.target,
          betMoney: legStakeCny(legA.betMoney, legA.type, accountA),
          betOdds: legA.odds,
          failedLegOdds: legB.odds,
          failedPlatformLabel: legB.type,
          observation: { executionId: legA.observation?.executionId, parentAttemptId: legA.observation?.attemptId, ownerUserId: legA.observation?.ownerUserId, anchorAttemptId: legA.observation?.attemptId, anchorOrderId: resultA?.orderId || undefined },
        });
        if (enqueued)
          trace?.event("补单", `${legB.type} 已加入补单队列`);
      }
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

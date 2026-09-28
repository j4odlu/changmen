import type { ArbBetAttemptParams, ArbBetPlaced } from "@/stores/betting/autoBet/phases/types";
import { registerRayRejectMonitor } from "@/extensions/arbBet/rayRejectMonitor/runtime";
import {
  recordSingleLeg9999MapFill,
  recordSingleLeg9999MapFillKeys,
  releaseSingleLeg9999MapFill,
  releaseSingleLeg9999MapFillKeys,
} from "@/extensions/arbBet/singleLeg9999MapCount";
import { refreshOrderListAfterBind } from "@/stores/betting/arbOrderBind";
import {
  applyArbMakeUpFromRejects,
  resolveArbMakeUpSuccessRef,
} from "@/stores/betting/autoBet/arbMakeUpFromRejects";
import { markArbSuccessLegs } from "@/stores/betting/autoBet/phases/finalizeArbMarkers";
import {
  finishArbExecutionTrace,
  logArbFinalizeTraceEvents,
  sendArbBettingMessageIfNeeded,
} from "@/stores/betting/autoBet/phases/finalizeArbMessaging";
import { settleBothArbLegs } from "@/stores/betting/autoBet/phases/settleBothArbLegs";
import { syncArbFinalizeActiveBet } from "@/stores/betting/autoBet/phases/syncArbFinalizeUi";
import { saveMakeUpCancelLog } from "@/services/bettingLog";
import { useLoseOrderStore } from "@/stores/loseOrderStore";
import { useUserStore } from "@/stores/userStore";

/**
 * [changmen 扩展] place 阶段允许先为 API 失败腿创建补单队列；若随后确认
 * 唯一的 API 成功腿实际拒单，则已无成交敞口，必须在队列消费前精确撤销。
 *
 * 仅撤销当前 bet/link、且锚账号与目标腿都吻合的自动补单，避免影响手动补单、
 * 旧 Link 或同盘口后续新一轮套利。
 */
function cancelQueuedMakeUpForRejectedAnchor(
  params: ArbBetAttemptParams,
  placed: ArbBetPlaced,
  settle: Awaited<ReturnType<typeof settleBothArbLegs>>,
): boolean {
  const { bet, trace } = params;
  const {
    accountA,
    betBothLegs,
    legA,
    legB,
    linkId,
    resultA,
    resultB,
  } = placed;

  // placeArbLegs 的提前入队只会发生在 A 接口成功、B 接口失败且已尝试的路径。
  if (!betBothLegs || !resultA?.success || resultB?.success || !settle.rejectA || !accountA)
    return false;

  const loseStore = useLoseOrderStore();
  const queued = loseStore.orders.get(bet.id);
  if (
    !queued
    || queued.isCreateOrder
    || Number(queued.linkId) !== Number(linkId)
    || Number(queued.accountId) !== Number(accountA.accountId)
    || queued.target !== legB.target
  ) {
    return false;
  }

  loseStore.removeOrder(bet.id, true);
  saveMakeUpCancelLog({
    linkId,
    betId: bet.id,
    target: legB.target,
    match: String(legB.match?.title || params.match.title || ""),
    bet: String(legB.bet?.getBetName() || bet.getBetName() || ""),
    failedPlatformLabel: legB.type,
    anchorProvider: legA.type,
    anchorAccountId: Number(accountA.accountId),
    anchorTarget: legA.target,
    reason: `${legA.type} ${legA.target} 确认拒单，已无有效成交锚点`,
  });
  trace?.event(
    "补单",
    `${legA.type} ${legA.target} 确认拒单，已取消 ${legB.type} ${legB.target} 补单队列`,
  );
  return true;
}

/** 套利收尾编排：settle → makeup → mark → notify（顺序对齐 A8 bundle） */
export async function finalizeArbBet(
  params: ArbBetAttemptParams,
  placed: ArbBetPlaced,
): Promise<void> {
  const { match, bet } = params;
  const { linkId } = placed;

  const settle = await settleBothArbLegs(params, placed);
  cancelQueuedMakeUpForRejectedAnchor(params, placed, settle);

  const registerRayLeg = (side: "A" | "B") => {
    const leg = side === "A" ? placed.legA : placed.legB;
    const account = side === "A" ? placed.accountA : placed.accountB;
    const result = side === "A" ? placed.resultA : placed.resultB;
    const initialOrders = side === "A" ? settle.ordersA : settle.ordersB;
    const initialRejected = side === "A" ? settle.rejectA : settle.rejectB;
    const anchorLeg = side === "A" ? placed.legB : placed.legA;
    const anchorAccount = side === "A" ? placed.accountB : placed.accountA;
    const anchorResult = side === "A" ? placed.resultB : placed.resultA;
    const anchorOrders = side === "A" ? settle.ordersB : settle.ordersA;
    const anchorRejected = side === "A" ? settle.rejectB : settle.rejectA;
    const anchorPending = side === "A" ? settle.pendingConfirmB : settle.pendingConfirmA;
    if (String(account?.provider || "").toUpperCase() !== "RAY" || !result?.success || !account)
      return;
    const anchorRef = anchorAccount
      ? resolveArbMakeUpSuccessRef(
          anchorLeg,
          anchorOrders,
          anchorRejected,
          anchorAccount,
          anchorResult?.orderId,
        )
      : { betMoney: 0, betOdds: 0 };
    const anchorProvider = String(anchorAccount?.provider || "").toUpperCase();
    registerRayRejectMonitor({
      linkId,
      matchId: match.id,
      betId: bet.id,
      side,
      accountId: Number(account.accountId),
      submittedAt: Number(result.beginTime) || Date.now(),
      match: String(leg.match?.title || match.title || ""),
      bet: String(leg.bet?.getBetName() || bet.getBetName() || ""),
      item: String(
        leg.target === "Home"
          ? leg.bet?.homeName || bet.homeName || leg.target
          : leg.bet?.awayName || bet.awayName || leg.target,
      ),
      target: leg.target,
      odds: Number(leg.odds) || 0,
      betMoney: Number(leg.betMoney) || 0,
      // 双 RAY 可能继续发生第二腿延迟拒单；第一版保守转人工，不把未终态腿当补单锚点。
      anchorConfirmed: Boolean(
        placed.betBothLegs
        && anchorAccount
        && anchorResult?.success
        && !anchorRejected
        && !anchorPending
        && anchorProvider !== "RAY",
      ),
      anchorProvider,
      anchorAccountId: Number(anchorAccount?.accountId) || 0,
      anchorBetMoney: anchorRef.betMoney,
      anchorOdds: anchorRef.betOdds,
      initialOrders,
      initialRejected,
    });
  };
  // [changmen 扩展] 只登记旁路监控；同步返回，不参与本轮 settle/makeup 判断。
  registerRayLeg("A");
  registerRayLeg("B");

  const makeup = await applyArbMakeUpFromRejects(
    params,
    placed,
    settle.rejectA,
    settle.rejectB,
    {
      ordersA: settle.ordersA,
      ordersB: settle.ordersB,
    },
    {
      pendingConfirmA: settle.pendingConfirmA,
      pendingConfirmB: settle.pendingConfirmB,
    },
  );

  logArbFinalizeTraceEvents(params.trace, linkId, placed, settle, makeup, bet.id);
  markArbSuccessLegs(bet, placed, settle);
  const singleLeg9999Filled = placed.singleLegByRate && (
    (placed.resultA?.success && placed.accountA && !settle.rejectA && !settle.pendingConfirmA)
    || (placed.resultB?.success && placed.accountB && !settle.rejectB && !settle.pendingConfirmB)
  );
  if (singleLeg9999Filled) {
    if (!placed.singleLeg9999MapReserved) {
      if (placed.singleLeg9999MapKeys?.length)
        recordSingleLeg9999MapFillKeys(placed.singleLeg9999MapKeys);
      else recordSingleLeg9999MapFill(match.id, bet.round);
    }
  }
  else if (placed.singleLeg9999MapReserved) {
    if (placed.singleLeg9999MapKeys?.length)
      releaseSingleLeg9999MapFillKeys(placed.singleLeg9999MapKeys);
    else releaseSingleLeg9999MapFill(match.id, bet.round);
  }
  refreshOrderListAfterBind();

  const outcome = syncArbFinalizeActiveBet(
    bet.id,
    placed,
    settle,
    makeup,
    params.config.makeUp === true,
  );
  finishArbExecutionTrace(params, placed, settle, outcome);
  sendArbBettingMessageIfNeeded(params, placed, settle);

  // [changmen 扩展] 仅开启时加载；关闭时与改前 finalize 路径一致（无额外 await）
  if (useUserStore().extensionPrefs?.arbFailAutoSell?.enabled === true) {
    try {
      const { maybeArbFailAutoSellAfterFinalize } = await import(
        "@/extensions/arbBet/arbFailAutoSell",
      );
      await maybeArbFailAutoSellAfterFinalize({
        placed,
        settle,
        makeup,
        setMessage: params.setMessage,
      });
    }
    catch {
      /* ignore */
    }
  }
}

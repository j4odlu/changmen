import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import type {
  ArbBetAttemptParams,
  ArbBetPlaced,
  ArbLegPlaceOutcome,
} from "@/stores/betting/autoBet/phases/types";
import { wait } from "@changmen/client-core/shared/wait";
import { isPendingConfirmVenueProvider } from "@changmen/shared/account_multiply";
import { saveVenueSettlementLog } from "@/services/bettingLog";
import { useAccountStore } from "@/stores/accountStore";
import { syncActiveBetLegSettleResult, syncActiveBetPhase } from "@/stores/betting/activeBetRunSync";
import { bindArbLegOrder, resolveArbBindOrderId } from "@/stores/betting/arbOrderBind";
import { settleArbLegUntilTerminal } from "@/stores/betting/autoBet/arbLegSettle";
import { isArbLegPlaceNeedsSettle } from "@/stores/betting/autoBet/phases/types";
import {
  maxLegRejectWaitSec,
  showRejectDetectionTip,
} from "@/stores/betting/autoBet/rejectWait";
import { enqueuePendingOrderBind } from "@/stores/betting/pendingOrderBind";

export interface ArbLegSettleSnapshot {
  ordersA: VenueOrder[];
  ordersB: VenueOrder[];
  rejectA: boolean;
  rejectB: boolean;
  pendingConfirmA: boolean;
  pendingConfirmB: boolean;
  /** place 回传；编排用，场馆层不改写 */
  placeOutcomeA: ArbLegPlaceOutcome;
  placeOutcomeB: ArbLegPlaceOutcome;
  boundLegLabels: string[];
  /** [changmen 扩展] Bind 最终失败的腿（已重试；有 orderId 可绑却失败） */
  bindFailedLegLabels: string[];
  bindFailedSides: Array<"A" | "B">;
}

function emptySettleSnapshot(
  placeOutcomeA: ArbLegPlaceOutcome,
  placeOutcomeB: ArbLegPlaceOutcome,
): ArbLegSettleSnapshot {
  return {
    ordersA: [],
    ordersB: [],
    rejectA: false,
    rejectB: false,
    pendingConfirmA: false,
    pendingConfirmB: false,
    placeOutcomeA,
    placeOutcomeB,
    boundLegLabels: [],
    bindFailedLegLabels: [],
    bindFailedSides: [],
  };
}

/** 成功腿：刷余额、空等 max(waitTime??5)、依次 updateOrders（对齐 A8） */
export async function settleBothArbLegs(
  params: ArbBetAttemptParams,
  placed: ArbBetPlaced,
): Promise<ArbLegSettleSnapshot> {
  const { bet, config, trace } = params;
  const accountStore = useAccountStore();
  const {
    legA,
    legB,
    accountA,
    accountB,
    linkId,
    waitSec,
    resultA,
    resultB,
    placeOutcomeA,
    placeOutcomeB,
  } = placed;

  const successAccounts: PlatformAccount[] = [];
  if (resultA?.success && accountA) {
    successAccounts.push(accountA);
    // delayed：CLOB 尚未扣款；早刷若慢于 settle 后补刷，会把旧余额盖回去
    if (!resultA.pending)
      void accountStore.refreshBalance(accountA);
  }
  if (resultB?.success && accountB) {
    successAccounts.push(accountB);
    if (!resultB.pending)
      void accountStore.refreshBalance(accountB);
  }

  if (!successAccounts.length) {
    // 无 API 成功腿：不进场馆 settle；编排层仍用 placeOutcome 收尾
    if (accountA && !isArbLegPlaceNeedsSettle(placeOutcomeA))
      syncActiveBetLegSettleResult(bet.id, "A", false, false);
    if (accountB && !isArbLegPlaceNeedsSettle(placeOutcomeB))
      syncActiveBetLegSettleResult(bet.id, "B", false, false);
    return emptySettleSnapshot(placeOutcomeA, placeOutcomeB);
  }

  const snapshot = emptySettleSnapshot(placeOutcomeA, placeOutcomeB);
  const maxWait = maxLegRejectWaitSec(config, successAccounts);
  // [A8 可证实] 普通场馆只要有 API 成功腿就弹 tip，检测等待为 0 也保留原有提示。
  const hasA8Success = successAccounts.some(account => !isPendingConfirmVenueProvider(account.provider));
  if (hasA8Success)
    void showRejectDetectionTip(waitSec);
  // wait=0（含纯 PM）：相位用「确认场馆结果」，不改变 A8 tip 的展示条件。
  if (maxWait > 0) {
    trace?.event("拒单", `空等 ${maxWait}s 后依次拉单`);
    syncActiveBetPhase(bet.id, "settling", "拒单检测", maxWait);
  }
  else {
    trace?.event("拒单", "确认场馆结果（无拒单等待）");
    syncActiveBetPhase(bet.id, "settling", "确认场馆结果");
  }

  // API 失败 / 未下单腿：不上场馆 settle，只回编排态（避免误标「未拒单」）
  if (accountA && !isArbLegPlaceNeedsSettle(placeOutcomeA))
    syncActiveBetLegSettleResult(bet.id, "A", false, false);
  if (accountB && !isArbLegPlaceNeedsSettle(placeOutcomeB))
    syncActiveBetLegSettleResult(bet.id, "B", false, false);

  const settleOne = async (side: "A" | "B"): Promise<void> => {
    const account = side === "A" ? accountA : accountB;
    const result = side === "A" ? resultA : resultB;
    const leg = side === "A" ? legA : legB;
    const placeOutcome = side === "A" ? placeOutcomeA : placeOutcomeB;
    if (!account || !result)
      return;
    const synced = await settleArbLegUntilTerminal(account, result, {
      // 编排层已空等 max；场馆层不再 sleep（A8 一次 wait 后立刻 updateOrders）
      rejectWaitSec: 0,
      pendingBindLinkId: linkId,
      betOption: leg,
    });
    if (side === "A") {
      snapshot.ordersA = synced.orders;
      snapshot.rejectA = synced.rejected;
      snapshot.pendingConfirmA = synced.pendingConfirm;
    }
    else {
      snapshot.ordersB = synced.orders;
      snapshot.rejectB = synced.rejected;
      snapshot.pendingConfirmB = synced.pendingConfirm;
    }
    const rejected = synced.rejected;
    saveVenueSettlementLog({
      account,
      option: leg,
      result,
      orders: synced.orders,
      settlement: synced.pendingConfirm ? "timeout" : rejected ? "unfilled" : "filled",
      linkId,
    });
    syncActiveBetLegSettleResult(bet.id, side, true, rejected, {
      pendingConfirm: synced.pendingConfirm,
      provider: account.provider,
      pendingDetail: placeOutcome === "accepted_pending_confirm" ? "已挂单待确认" : "delayed 待确认",
    });
    const orderId = resolveArbBindOrderId(synced.orders, result, rejected);
    if (await bindArbLegOrder(linkId, account, result, synced.orders, rejected)) {
      snapshot.boundLegLabels.push(leg.type);
    }
    else if (orderId) {
      snapshot.bindFailedLegLabels.push(leg.type);
      snapshot.bindFailedSides.push(side);
      enqueuePendingOrderBind({
        observation: result.observation,
        target: leg.target,
        linkId,
        provider: result.provider,
        accountId: account.accountId,
        orderId,
        betId: bet.id,
        side,
      });
    }
    if (
      isPendingConfirmVenueProvider(account.provider)
      && result.pending
      && !synced.pendingConfirm
    ) {
      void accountStore.refreshBalance(account);
    }
  };

  const settleA = Boolean(resultA?.success && accountA);
  const settleB = Boolean(resultB?.success && accountB);
  const pendingA = settleA && isPendingConfirmVenueProvider(accountA!.provider);
  const pendingB = settleB && isPendingConfirmVenueProvider(accountB!.provider);
  const a8A = settleA && !pendingA;
  const a8B = settleB && !pendingB;

  const pendingTasks: Promise<void>[] = [];
  if (pendingA)
    pendingTasks.push(settleOne("A"));
  if (pendingB)
    pendingTasks.push(settleOne("B"));

  // [A8 可证实] 成功腿 waitTime??5 取 max，空等后再依次 updateOrders
  if (maxWait > 0 && (a8A || a8B))
    await wait(maxWait * 1000);
  if (a8A)
    await settleOne("A");
  if (a8B)
    await settleOne("B");
  await Promise.all(pendingTasks);

  // 仅对已交场馆 settle 的腿报告拒单结果；API 失败/未下单不伪造成「未拒单」
  const rejectLine = (side: "A" | "B") => {
    const account = side === "A" ? accountA : accountB;
    const result = side === "A" ? resultA : resultB;
    const leg = side === "A" ? legA : legB;
    const outcome = side === "A" ? placed.placeOutcomeA : placed.placeOutcomeB;
    const rejected = side === "A" ? snapshot.rejectA : snapshot.rejectB;
    const pending = side === "A" ? snapshot.pendingConfirmA : snapshot.pendingConfirmB;
    if (!account)
      return null;
    if (result?.success) {
      if (pending) {
        return `${leg.type} 待确认`;
      }
      if (rejected)
        return `${leg.type} 🔴拒单`;
      // A8「否」= 未拒单；PM/PF filled 直接报成交
      if (isPendingConfirmVenueProvider(account.provider))
        return `${leg.type} 已成交`;
      return `${leg.type} 否`;
    }
    if (outcome === "not_attempted")
      return `${leg.type} 未下单`;
    const failMsg = String(result?.message ?? "").trim();
    return failMsg || `${leg.type} 下单失败`;
  };

  trace?.event(
    "拒单",
    [rejectLine("A"), rejectLine("B")].filter(Boolean).join(" · "),
  );

  return snapshot;
}

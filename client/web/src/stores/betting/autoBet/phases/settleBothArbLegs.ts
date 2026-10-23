import type { VenueOrder } from "@changmen/venue-browser/adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import type { OriginalLegFacts } from "@/domain/betting/originalLegExecution";
import type {
  ArbBetAttemptParams,
  ArbBetPlaced,
  ArbLegPlaceOutcome,
} from "@/stores/betting/autoBet/phases/types";
import { wait } from "@changmen/client-core/shared/wait";
import { isPendingConfirmVenueProvider } from "@changmen/shared/account_multiply";
import { saveVenueSettlementLog } from "@/services/bettingLog";
import { invalidatePmBalanceQueries } from "@/domain/polymarket/pmBalanceRejection";
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
  factsA?: OriginalLegFacts;
  factsB?: OriginalLegFacts;
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

  const refreshPmBalance = (account: PlatformAccount) => {
    invalidatePmBalanceQueries(account);
    try { void Promise.resolve(accountStore.refreshBalance(account)).catch(() => {}); }
    catch { /* 余额补刷失败不能影响已取得的原单事实和绑单。 */ }
  };

  const successAccounts: PlatformAccount[] = [];
  if (resultA?.success && accountA) {
    successAccounts.push(accountA);
    // delayed 在原单确认终态后补刷；pending 状态本身不能说明场馆是否已占用资金。
    if (!resultA.pending) {
      if (accountA.provider === "Polymarket") refreshPmBalance(accountA);
      else void accountStore.refreshBalance(accountA);
    }
  }
  if (resultB?.success && accountB) {
    successAccounts.push(accountB);
    if (!resultB.pending) {
      if (accountB.provider === "Polymarket") refreshPmBalance(accountB);
      else void accountStore.refreshBalance(accountB);
    }
  }

  if (!successAccounts.length && !resultA?.pmSubmitUnknown && !resultB?.pmSubmitUnknown) {
    // 无 API 成功腿：不进场馆 settle；编排层仍用 placeOutcome 收尾
    if (accountA && !isArbLegPlaceNeedsSettle(placeOutcomeA))
      syncActiveBetLegSettleResult(bet.id, "A", false, false);
    if (accountB && !isArbLegPlaceNeedsSettle(placeOutcomeB))
      syncActiveBetLegSettleResult(bet.id, "B", false, false);
    return emptySettleSnapshot(placeOutcomeA, placeOutcomeB);
  }

  const snapshot = emptySettleSnapshot(placeOutcomeA, placeOutcomeB);
  const original = placed.originalExecution;
  const maxWait = original
    ? Math.max(0, ...[placed.legA, placed.legB].map((leg, index) => (index === 0 ? resultA : resultB)?.success ? original.legs.get(leg)?.rejectWaitSec ?? 0 : 0))
    : maxLegRejectWaitSec(config, successAccounts);
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
    // [changmen 扩展] adapter 确认终态会清除 result.pending，补刷判断必须保留确认前状态。
    const wasPending = result.pending === true;
    const execution = original?.legs.get(leg);
    const synced = execution ? await execution.confirm(result) : await settleArbLegUntilTerminal(account, result, {
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
    if (account.provider === "Polymarket" && wasPending && !synced.pendingConfirm)
      refreshPmBalance(account);
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
    // [changmen 扩展] RAY 始终使用公共绑单及失败重试；PM 执行副本只记录配对事实。
    if (execution) {
      if (side === "A") snapshot.factsA = execution.facts();
      else snapshot.factsB = execution.facts();
      if (account.provider !== "RAY") {
        if (synced.orders.length) snapshot.boundLegLabels.push(leg.type);
        return;
      }
    }
    if (result.pmSubmitUnknown) return;
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
    // 非 PM 场馆保留原来的刷新时点与判断，不把 PM 的 pending 快照策略扩展到其他平台。
    if (account.provider !== "Polymarket" && isPendingConfirmVenueProvider(account.provider)
      && result.pending && !synced.pendingConfirm)
      void accountStore.refreshBalance(account);
  };

  const settleA = Boolean((resultA?.success || resultA?.pmSubmitUnknown) && accountA);
  const settleB = Boolean((resultB?.success || resultB?.pmSubmitUnknown) && accountB);
  // [changmen 扩展] 原腿的等待由公共流程完成；含 PF 等确认型场馆，不能提前核对后跳过原等待。
  const pendingA = settleA && isPendingConfirmVenueProvider(accountA!.provider)
    && (!original || (original.legs.get(legA)?.rejectWaitSec ?? 0) === 0);
  const pendingB = settleB && isPendingConfirmVenueProvider(accountB!.provider)
    && (!original || (original.legs.get(legB)?.rejectWaitSec ?? 0) === 0);
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

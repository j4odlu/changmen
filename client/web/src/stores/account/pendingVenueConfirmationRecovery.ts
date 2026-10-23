// [changmen 扩展] 待确认订单生命周期；与 betGateway 共用单例，保持原有业务时序。
import type { PlatformAccount } from "@/models/platformAccount";
import type { AccountStoreContext } from "@/stores/account/context";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { validatePmSubmission, type PmSubmission } from "@changmen/shared/pm_submission";
import { pmAccountSubmitAttempts, pmSubmitScope, pmSubmitMaker } from "@changmen/venue-browser/adapter/polymarket";
import { getAuthSessionVersion, isAuthSessionCurrent } from "@/api/client";
import { getPendingPmOrders } from "@/api/order";
import { pendingVenueBetConfirmations, pendingVenueConfirmationTimers, pendingVenueConfirmationResumeVersions, pendingVenueOrderWrites, pendingPmRestoreFlights, pendingPmRestoreTimers, pendingVenueConfirmationSession, persistPendingVenueBetConfirmations } from "./pendingVenueConfirmationState";
import type { PendingVenueBetConfirmation } from "./pendingVenueConfirmationState";
import { schedulePendingVenueBetConfirmation } from "./pendingVenueConfirmationRunner";

/** [changmen 扩展] 退出/切换工作区时暂停调度，保留原单以便账号加载后恢复。 */
export function pausePendingVenueConfirmations(): void {
  pendingVenueConfirmationSession.paused = true;
  pendingVenueConfirmationSession.epoch += 1;
  for (const { timer } of pendingVenueConfirmationTimers.values()) clearTimeout(timer);
  pendingVenueConfirmationTimers.clear();
  for (const timer of pendingPmRestoreTimers.values()) clearTimeout(timer);
  pendingPmRestoreTimers.clear();
  pendingVenueConfirmationResumeVersions.clear();
}

/** 账号加载后恢复手动/正 EV 单的场馆待确认任务。 */
export function resumePendingVenueConfirmations(store: AccountStoreContext): void {
  pendingVenueConfirmationSession.paused = false;
  void restoreStoredPendingPmOrders(store);
  for (const account of store.accounts ?? []) {
    if (account.provider !== "Polymarket") continue;
    try {
      for (const attempt of pmAccountSubmitAttempts(account)) {
        const recovery = attempt.recovery;
        if (attempt.side !== "BUY" || !recovery) continue;
        const orderId = attempt.acceptedOrderId || attempt.orderHash;
        const pmScope = pmSubmitScope(account);
        const key = `${pmScope}:${orderId}`;
        const pmSubmission: PmSubmission = { orderId, accountId: account.accountId, makerAmount: attempt.makerAmount,
          stakeUsdc: Number(attempt.makerAmount) / 1e6, submittedAt: attempt.submittedAt,
          makerAddress: pmSubmitMaker(account),
          ...(attempt.takerAmount ? { takerAmount: attempt.takerAmount } : {}),
          submitUnknown: !attempt.acceptedOrderId };
        const legacy = [...pendingVenueBetConfirmations.values()].find(task => task.provider === "Polymarket"
          && task.accountId === account.accountId && task.orderId === orderId && (!task.pmScope || task.pmScope === pmScope));
        if (legacy) {
          Object.assign(legacy, recovery, { pmScope,
            pmSubmission: validatePmSubmission({ ...legacy.pmSubmission, ...pmSubmission }, orderId, account.accountId) ?? pmSubmission });
          continue;
        }
        if (pendingVenueBetConfirmations.has(key)) continue;
        pendingVenueBetConfirmations.set(key, { ...recovery, target: recovery.target as BetOption["target"],
          key, pmScope, accountId: account.accountId, provider: "Polymarket", orderId,
          betRowId: recovery.betRowId ?? 0, accountLine: "", detailHtml: "",
          toastSeconds: 3, attempts: 0, nextPollAt: Date.now(),
          pmSubmission });
      }
    } catch { /* 凭证尚未加载时保留原记录，下次恢复 */ }
  }
  persistPendingVenueBetConfirmations();
  for (const task of pendingVenueBetConfirmations.values()) {
    pendingVenueConfirmationResumeVersions.set(task.key, getAuthSessionVersion());
    schedulePendingVenueBetConfirmation(store, task);
  }
}

async function restoreStoredPendingPmOrders(store: AccountStoreContext): Promise<void> {
  await Promise.allSettled((store.accounts ?? []).filter(account => account.provider === "Polymarket")
    .map(account => restoreStoredPendingPmAccount(store, account)));
}

async function restoreStoredPendingPmAccount(store: AccountStoreContext, account: PlatformAccount): Promise<void> {
  let scope: string;
  try { scope = pmSubmitScope(account); } catch { return; }
  const version = getAuthSessionVersion();
  const epoch = pendingVenueConfirmationSession.epoch;
  const flightKey = JSON.stringify([version, scope, account.accountId, epoch]);
  if (pendingPmRestoreFlights.has(flightKey)) return;
  const retry = pendingPmRestoreTimers.get(flightKey);
  if (retry) { clearTimeout(retry); pendingPmRestoreTimers.delete(flightKey); }
  pendingPmRestoreFlights.add(flightKey);
  const current = () => {
    try {
      const live = store.findAccount(account.accountId);
      return !pendingVenueConfirmationSession.paused && epoch === pendingVenueConfirmationSession.epoch
        && isAuthSessionCurrent(version) && live?.provider === "Polymarket" && scope === pmSubmitScope(live);
    }
    catch { return false; }
  };
  try {
    const rows = await getPendingPmOrders(account.accountId);
    if (!current()) return;
    for (const row of rows) {
      const submission = validatePmSubmission(row.submission, row.orderId, account.accountId);
      if (!submission?.makerAddress || submission.makerAddress !== pmSubmitMaker(account)) continue;
      const existing = [...pendingVenueBetConfirmations.values()].find(task =>
        task.provider === "Polymarket" && task.accountId === account.accountId
        && task.orderId === row.orderId && (!task.pmScope || task.pmScope === scope));
      if (existing) {
        pendingVenueOrderWrites.delete(existing); // RDS 已证实完整订单已保存。
        existing.pmScope = scope;
        existing.pmSubmission = submission;
        existing.matchId ||= row.matchId;
        existing.venueBetId ||= row.conditionId;
        existing.itemId ||= row.tokenId;
        existing.linkId ||= row.linkId;
        persistPendingVenueBetConfirmations();
        schedulePendingVenueBetConfirmation(store, existing);
        continue;
      }
      const key = `${scope}:${row.orderId}`;
      const task: PendingVenueBetConfirmation = {
        key, pmScope: scope, accountId: account.accountId, provider: "Polymarket", orderId: row.orderId,
        matchId: row.matchId, venueBetId: row.conditionId, itemId: row.tokenId,
        target: row.target as BetOption["target"], betRowId: 0, betMoney: submission.stakeUsdc,
        odds: row.odds, linkId: row.linkId, pmSubmission: submission, recoveryOnly: true,
        accountLine: "", detailHtml: "", toastSeconds: 3, attempts: 0, nextPollAt: Date.now(),
      };
      pendingVenueBetConfirmations.set(key, task);
      persistPendingVenueBetConfirmations();
      schedulePendingVenueBetConfirmation(store, task);
    }
  }
  catch {
    if (current()) pendingPmRestoreTimers.set(flightKey, setTimeout(() => {
      pendingPmRestoreTimers.delete(flightKey);
      if (current()) void restoreStoredPendingPmAccount(store, store.findAccount(account.accountId)!);
    }, 5_000));
  }
  finally { pendingPmRestoreFlights.delete(flightKey); }
}

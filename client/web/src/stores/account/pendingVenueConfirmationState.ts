// [changmen 扩展] 待确认订单生命周期；与 betGateway 共用单例，保持原有业务时序。
import type { ObservationContext } from "@changmen/shared/order_observation";
import type { AccountStoreContext } from "@/stores/account/context";
import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BettingEventPayload } from "@/realtime/bettingEventPayload";
import type { PmSubmission } from "@changmen/shared/pm_submission";
import { pmSubmitScope } from "@changmen/venue-browser/adapter/polymarket";

const PENDING_VENUE_CONFIRM_KEY = "PENDING_VENUE_BET_CONFIRM";

export interface PendingVenueBetConfirmation {
  publishData?: BettingEventPayload;
  pmScope?: string;
  pmSubmission?: PmSubmission;
  /** 已由套利/补单队列计数的尝试，恢复页只核对与同步原单。 */
  recoveryOnly?: boolean;
  observation?: ObservationContext;
  linkId?: number;
  key: string;
  accountId: number;
  provider: string;
  orderId: string;
  matchId: string;
  venueBetId: string;
  itemId: string;
  betRowId: number;
  target: BetOption["target"];
  betMoney: number;
  odds: number;
  accountLine: string;
  detailHtml: string;
  toastSeconds: number;
  attempts: number;
  nextPollAt: number;
}

function loadPendingVenueBetConfirmations(): Map<string, PendingVenueBetConfirmation> {
  try {
    const rows = JSON.parse(sessionStorage.getItem(PENDING_VENUE_CONFIRM_KEY) || "[]") as PendingVenueBetConfirmation[];
    return new Map(rows.filter(row => row?.key && row.orderId).map(row => [row.key, row]));
  }
  catch {
    return new Map();
  }
}

export const pendingVenueBetConfirmations = loadPendingVenueBetConfirmations();

export const pendingVenueConfirmationFlights = new Set<string>();

export const pendingVenueConfirmationTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; version: string }>();

export const pendingVenueConfirmationResumeVersions = new Map<string, string>();

// 仅串行化同一订单的写入；Promise 不进入 sessionStorage。
export const pendingVenueOrderWrites = new WeakMap<PendingVenueBetConfirmation, Promise<void>>();

export const pendingPmRestoreFlights = new Set<string>();

export const pendingPmRestoreTimers = new Map<string, ReturnType<typeof setTimeout>>();

// 两个模块共享实时值；暂停时增加 epoch，使旧异步结果失效。
export const pendingVenueConfirmationSession = { paused: false, epoch: 0 };

export function pendingVenueAccountMatches(store: AccountStoreContext, task: PendingVenueBetConfirmation): boolean {
  try {
    const live = store.findAccount(task.accountId);
    return live?.provider === task.provider && (!task.pmScope || task.pmScope === pmSubmitScope(live));
  }
  catch { return false; }
}

export function persistPendingVenueBetConfirmations(): void {
  try {
    sessionStorage.setItem(
      PENDING_VENUE_CONFIRM_KEY,
      JSON.stringify([...pendingVenueBetConfirmations.values()]),
    );
  }
  catch {
    /* sessionStorage 不可用时仍保留当前页单飞续查 */
  }
}

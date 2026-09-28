import type { BetSide } from "@/models/match";
import type { FollowOrderInput, LoseOrderCancelledRecord, LoseOrderRecord, MakeupRuntimePhase } from "@/types/order";
import { defineStore } from "pinia";
import { LoseOrder } from "@/models/loseOrder";
import { useMatchStore } from "@/stores/matchStore";
import { useMessageStore } from "@/stores/messageStore";

const STORAGE_KEY = "LOSEORDER";
const CANCELLED_STORAGE_KEY = "LOSEORDER_CANCELLED";

/** [A8 可证实] store 定义处同步 IIFE 从 sessionStorage 恢复 */
function restoreOrdersFromSession(): Map<number, LoseOrder> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw)
      return new Map();
    const list = JSON.parse(raw) as LoseOrderRecord[];
    const map = new Map(list.map(row => [row.betId, new LoseOrder(row)]));
    for (const order of map.values()) {
      if (order.runtimePhase === "placing" || order.runtimePhase === "settling")
        order.runtimePhase = undefined;
    }
    return map;
  }
  catch {
    return new Map();
  }
}

function restoreCancelledFromSession(): Map<number, LoseOrderCancelledRecord> {
  try {
    const raw = sessionStorage.getItem(CANCELLED_STORAGE_KEY);
    if (!raw)
      return new Map();
    const list = JSON.parse(raw) as LoseOrderCancelledRecord[];
    return new Map(list.map(row => [row.betId, row]));
  }
  catch {
    return new Map();
  }
}

/** 对齐 A8 Pinia `jb`：Map 键为 betId */
export const useLoseOrderStore = defineStore("loseorder", {
  state: () => ({
    orders: restoreOrdersFromSession(),
    cancelledOrders: restoreCancelledFromSession(),
  }),

  getters: {
    count: s => s.orders.size,
    /** linkId=0 的手动补单（订单列表上方单独展示） */
    manualOrders(state): LoseOrder[] {
      return [...state.orders.values()].filter(order => !order.isLinkBoundMakeup());
    },
    linkBoundCount(state): number {
      let n = 0;
      for (const order of state.orders.values()) {
        if (order.isLinkBoundMakeup())
          n += 1;
      }
      return n;
    },
  },

  actions: {
    restore() {
      this.orders = restoreOrdersFromSession();
      this.cancelledOrders = restoreCancelledFromSession();
    },

    ensureOrdersMap() {
      if (!(this.orders instanceof Map))
        this.orders = new Map();
      if (!(this.cancelledOrders instanceof Map))
        this.cancelledOrders = new Map();
    },

    persist() {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([...this.orders.values()].map(o => o.toJSON())),
      );
    },

    persistCancelled() {
      sessionStorage.setItem(
        CANCELLED_STORAGE_KEY,
        JSON.stringify([...this.cancelledOrders.values()]),
      );
    },

    touchOrdersMap() {
      this.orders = new Map(this.orders);
    },

    touchCancelledMap() {
      this.cancelledOrders = new Map(this.cancelledOrders);
    },

    createOrder(order: LoseOrder) {
      const next = new Map(this.orders);
      next.set(order.betId, order);
      this.orders = next;
      this.persist();
      // [A8 可证实] jb.createOrder：仅手动 isCreateOrder 时 PublishLoseOrderMessage
      if (order.isCreateOrder) {
        void useMessageStore().publishLoseOrderMessage();
      }
    },

    /** 受理后确认场馆：挂原单供 jb 续查（勿重复 POST） */
    setPendingVenueOrder(
      betId: number,
      orderId: string,
      accountId: number,
      opts: {
        role?: "target" | "anchor";
        pendingTarget?: BetSide;
        conditionId?: string;
        makeUpEligible?: boolean;
      } = {},
    ) {
      const existing = this.orders.get(betId);
      if (!existing)
        return;
      const id = String(orderId ?? "").trim();
      if (!id)
        return;
      const changed = existing.pendingVenueOrderId !== id;
      existing.pendingVenueOrderId = id;
      existing.pendingVenueAccountId = Number(accountId) || undefined;
      existing.pendingVenueRole = opts.role ?? existing.pendingVenueRole ?? "target";
      existing.pendingVenueTarget = opts.pendingTarget ?? existing.pendingVenueTarget;
      existing.pendingVenueMakeUpEligible
        = opts.makeUpEligible ?? existing.pendingVenueMakeUpEligible ?? true;
      const conditionId = String(opts.conditionId ?? "").trim();
      if (conditionId)
        existing.pendingVenueConditionId = conditionId;
      if (changed) {
        existing.pendingVenueAttempts = 0;
        existing.pendingVenueNextPollAt = undefined;
      }
      existing.runtimePhase = "venue_pending";
      this.touchOrdersMap();
      this.persist();
    },

    clearPendingVenueOrder(betId: number) {
      const existing = this.orders.get(betId);
      if (!existing)
        return;
      const hadPending = Boolean(existing.pendingVenueOrderId)
        || Boolean((existing as { pendingPmOrderId?: string }).pendingPmOrderId);
      if (!hadPending)
        return;
      existing.pendingVenueOrderId = undefined;
      existing.pendingVenueAccountId = undefined;
      existing.pendingVenueRole = undefined;
      existing.pendingVenueTarget = undefined;
      existing.pendingVenueConditionId = undefined;
      existing.pendingVenueNextPollAt = undefined;
      existing.pendingVenueAttempts = undefined;
      existing.pendingVenueMakeUpEligible = undefined;
      delete (existing as { pendingPmOrderId?: string }).pendingPmOrderId;
      delete (existing as { pendingPmAccountId?: number }).pendingPmAccountId;
      if (existing.runtimePhase === "venue_pending" || existing.runtimePhase === "pm_pending")
        existing.runtimePhase = undefined;
      this.touchOrdersMap();
      this.persist();
    },

    deferPendingVenueOrder(betId: number) {
      const existing = this.orders.get(betId);
      if (!existing?.pendingVenueOrderId)
        return;
      const attempts = Math.max(0, Number(existing.pendingVenueAttempts) || 0) + 1;
      existing.pendingVenueAttempts = attempts;
      existing.pendingVenueNextPollAt = Date.now() + Math.min(30_000, 1_000 * 2 ** Math.min(attempts - 1, 5));
      this.touchOrdersMap();
      this.persist();
    },

    setMakeupRuntimePhase(betId: number, phase: MakeupRuntimePhase | undefined) {
      const existing = this.orders.get(betId);
      if (!existing)
        return;
      existing.runtimePhase = phase;
      this.touchOrdersMap();
      this.persist();
    },

    createFollowOrder(
      seed: { matchId: number; betId: number; target: BetSide; odds: number },
      follow: FollowOrderInput,
    ) {
      if (!follow?.isOpen || !follow.betMoney)
        return;
      const matchStore = useMatchStore();
      const match = matchStore.matchs.find(m => m.id === seed.matchId);
      if (!match)
        return;
      const bet = match.bets.find(b => b.id === seed.betId);
      if (!bet)
        return;
      const combinedOdds = Number(seed.odds) + Number(follow.odds ?? 0);
      const order = new LoseOrder({
        accountId: 0,
        matchId: seed.matchId,
        betId: seed.betId,
        target: seed.target,
        betMoney: Number(follow.betMoney),
        betOdds: combinedOdds,
        match: match.title,
        bet: bet.getBetName(),
        linkId: 0,
        createAt: Date.now(),
        isCreateOrder: true,
        betCount: 1,
      });
      this.createOrder(order);
    },

    removeOrder(betId: number, force = false) {
      const existing = this.orders.get(betId);
      if (!existing)
        return;
      const next = new Map(this.orders);
      if (!force && existing.betCount > 1) {
        existing.betCount -= 1;
        next.set(betId, existing);
      }
      else {
        next.delete(betId);
      }
      this.orders = next;
      this.persist();
    },

    /** [changmen 扩展] 侧栏补单行手动取消：出队即消失，不留占位行 */
    cancelMakeupManually(betId: number) {
      const existing = this.orders.get(betId);
      if (!existing)
        return;
      const linkId = Number(existing.linkId) || 0;
      this.removeOrder(betId, true);
      void import("@/stores/activeBetRunStore")
        .then(({ useActiveBetRunStore }) => useActiveBetRunStore().removeRun(betId))
        .catch(() => {});
      // 仅扩展开启时减仓；关闭时与改前「只出队」一致
      if (linkId) {
        void import("@/stores/userStore")
          .then(({ useUserStore }) => {
            if (useUserStore().extensionPrefs?.arbFailAutoSell?.enabled !== true)
              return;
            return import("@/extensions/arbBet/arbFailAutoSell").then(
              ({ maybeArbFailAutoSellByLink }) => maybeArbFailAutoSellByLink({
                linkId,
                reason: "用户取消补单",
              }),
            );
          })
          .catch(() => {});
      }
    },

    /** [A8 可证实] 60s prune：不在赛事列表的 bet 一律出队 */
    removeOrders(activeBetIds: number[]) {
      const active = new Set(activeBetIds);
      for (const betId of [...this.orders.keys()]) {
        const existing = this.orders.get(betId);
        if (!existing)
          continue;
        if (!active.has(betId) && !existing.pendingVenueOrderId) {
          const linkId = Number(existing.linkId) || 0;
          this.removeOrder(betId, true);
          if (linkId) {
            void import("@/stores/userStore")
              .then(({ useUserStore }) => {
                if (useUserStore().extensionPrefs?.arbFailAutoSell?.enabled !== true)
                  return;
                return import("@/extensions/arbBet/arbFailAutoSell").then(
                  ({ maybeArbFailAutoSellByLink }) => maybeArbFailAutoSellByLink({
                    linkId,
                    reason: "补单目标已离盘",
                  }),
                );
              })
              .catch(() => {});
          }
        }
      }
    },

    init() {
      this.restore();
      this.ensureOrdersMap();
    },
  },
});

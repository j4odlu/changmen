import { isPmPendingOrder } from "@changmen/shared/pm_submission";
import type { OrderRow } from "@/types/order";
import { defineStore } from "pinia";
import { getOrderList } from "@/api/esport";
import { Currency, getExchange } from "@changmen/shared/currency";
import {
  dropOrphanPolymarketSellGroups,
  filterOrdersBelongingToDate,
  groupOrdersByEffectiveLink,
  isLinkedArbOrderGroup,
  isPolymarketOpenPosition,
  isPredictionSellRow,
  orderBelongsToDateKey,
  orderLinkLegend,
  orderLinkMapEntries,
  toOrderDateKeyLocal,
  computeOrderGroupProfit,
  polymarketMoneyForAggregate,
} from "@/shared/orderLink";
import { truncateShareUsdtAmount } from "@/shared/pfOrderDisplay";
import { resolvePmRemainingShares } from "@changmen/venue-browser/adapter/polymarket";
import { accountOrderDisplayName } from "@/shared/accountDisplayName";
import { useAccountStore } from "@/stores/accountStore";
import { useMessageStore } from "@/stores/messageStore";
import { useUserStore } from "@/stores/userStore";

function todayKey() {
  return toOrderDateKeyLocal(Date.now());
}

function isSportsOrder(row: OrderRow): boolean {
  return String(row.Domain ?? "").trim() === "sports";
}

type FetchOrdersOptions = {
  sideEffects?: boolean;
};

export { isLinkedArbOrderGroup as isLinkedArbGroup };

/** 对齐 A8 `Io.getOrders` / `orders` / `orderDate` */
export const useOrderStore = defineStore("order", {
  state: () => ({
    orders: new Map<number, OrderRow[]>(),
    orderDate: todayKey(),
    dayProfit: 0,
    loading: false,
    filterAccountId: 0,
  }),

  getters: {
    filteredOrders(state): Map<number, OrderRow[]> {
      if (!state.filterAccountId)
        return state.orders;
      const out = new Map<number, OrderRow[]>();
      for (const [link, rows] of state.orders) {
        const filtered = rows.filter(r => r.PlayerID === state.filterAccountId);
        if (filtered.length)
          out.set(link, filtered);
      }
      return out;
    },

    /** 模板 v-for：顺序与 A8 groupBy(Link) 一致（已按 Link 降序） */
    orderEntries(): [number, OrderRow[]][] {
      return orderLinkMapEntries(this.filteredOrders);
    },

    accountOptions(): { value: number; label: string }[] {
      const accounts = useAccountStore().accounts;
      const seen = new Set(accounts.map(a => a.accountId));
      const opts = accounts.map(a => ({
        value: a.accountId,
        label: `${a.platformName || a.provider}/${accountOrderDisplayName(a)}`,
      }));
      // 已删账号仍出现在当日订单：筛选取名对齐后台历史展示
      for (const rows of this.orders.values()) {
        for (const r of rows) {
          const pid = Number(r.PlayerID) || 0;
          if (!pid || seen.has(pid))
            continue;
          seen.add(pid);
          const name = String(r.Player?.UserName || "").trim() || `#${pid}`;
          const platform = String(r.Player?.Platform || r.Type || "").trim();
          const base = platform ? `${platform}/${name}` : name;
          opts.push({
            value: pid,
            label: r.PlayerDeleted ? `${base}（已删）` : base,
          });
        }
      }
      return [{ value: 0, label: "全部" }, ...opts];
    },
  },

  actions: {
    /** [A8 可证实] `Io.getOrders` / `E()`：`groupBy(Link)` + `updateTodayProfit` */
    async fetchOrders(date?: string, options: FetchOrdersOptions = {}) {
      const userStore = useUserStore();
      if (!userStore.userId)
        return false;
      const sideEffects = options.sideEffects !== false;
      const accountStore = useAccountStore();
      if (!accountStore.accounts.length && accountStore.loaded) {
        /* 允许空账号时仍拉订单 */
      }
      this.loading = true;
      try {
        const nextDate = date ?? todayKey();
        this.orderDate = nextDate;
        const page = await getOrderList({ date: this.orderDate, pageSize: 1024 });
        if (!page)
          return false;
        // 后端已按 Link 开弓日取数并过滤；前端再滤一次防脏数据
        const list = filterOrdersBelongingToDate(page.list ?? [], this.orderDate);
        this.orders = dropOrphanPolymarketSellGroups(groupOrdersByEffectiveLink(list));
        if (sideEffects) {
          this.updateTodayProfit(list);
          const reportBase = list.filter(r => !isSportsOrder(r));
          const reportRows = reportBase
            .filter(r => !isPmPendingOrder(r) && orderBelongsToDateKey(r, this.orderDate, reportBase))
            .map(r => ({ ...r, Money: polymarketMoneyForAggregate(r, reportBase) }));
          useMessageStore().orderReportMessage(accountStore.accounts, reportRows);
          // 恢复「平仓中」会话：跑完 CLOB 终态（已平仓 / 可再卖）
          void import("@/stores/account/pmManualSell")
            .then(m => m.resumePmManualSellClosings())
            .catch(() => {});
        }
        return true;
      }
      finally {
        this.loading = false;
      }
    },

    updateTodayProfit(list: OrderRow[]) {
      const accountStore = useAccountStore();
      const today = this.orderDate;
      /** 展示已按 Link 开弓日过滤；盈亏与列表同一天 */
      const esportList = list.filter(r => !isSportsOrder(r));
      const inDay = esportList.filter(r => orderBelongsToDateKey(r, today, esportList));
      const moneyOf = (r: OrderRow) => polymarketMoneyForAggregate(r, inDay);
      const byPlayer = new Map<number, OrderRow[]>();
      for (const row of inDay) {
        const pid = Number(row.PlayerID) || 0;
        if (!byPlayer.has(pid))
          byPlayer.set(pid, []);
        byPlayer.get(pid)!.push(row);
      }

      const accById = new Map(accountStore.accounts.map(a => [a.accountId, a]));

      for (const acc of accById.values()) {
        acc.today = 0;
        acc.orderCount = 0;
        if (today === todayKey())
          acc.todayOrder = 0;
      }

      for (const [playerId, rows] of byPlayer) {
        const acc = accById.get(playerId);
        if (!acc)
          continue;
        const profit = rows.reduce((sum, r) => sum + moneyOf(r), 0);
        acc.today = Math.round(profit);
        // 笔数不计 PM/PF 卖单（依附买单）
        const primaryCount = rows.filter(r => !isPmPendingOrder(r) && !isPredictionSellRow(r)).length;
        acc.orderCount = primaryCount;
        if (today === todayKey()) {
          acc.todayOrder = primaryCount;
          const unsettled = rows.filter((r) => {
            if (isPredictionSellRow(r))
              return false;
            if (String(r.Status ?? "") !== "None")
              return false;
            if (String(r.Type ?? "") === "Polymarket")
              return isPolymarketOpenPosition(r);
            if (String(r.Type ?? "") === "PredictFun") {
              const state = String(r.PfSellState ?? "").toLowerCase();
              if (state === "closed" || state === "settled")
                return false;
              return true;
            }
            return true;
          });
          acc.unsettle = unsettled.length;
          acc.winBalance
            = (acc.balance ?? 0)
              + unsettled.reduce((sum, r) => {
                const fx = getExchange(Currency.USDT);
                if (String(r.Type ?? "") === "Polymarket" && r.PmSide !== "sell") {
                  const rem = resolvePmRemainingShares(r);
                  if (rem > 0.0001)
                    return sum + rem * fx;
                  const fill = Number(r.PmShares) || 0;
                  if (fill > 0.0001)
                    return sum + fill * fx;
                  const stakeUsdc = Number(r.PmStakeUsdc) || 0;
                  const price = Number(r.PmFillPrice);
                  if (stakeUsdc > 0 && price > 0 && price < 1)
                    return sum + (stakeUsdc / price) * fx;
                  return sum;
                }
                if (String(r.Type ?? "") === "PredictFun" && r.PfSide !== "sell") {
                  const hold = Number(r.PfHoldShares) || 0;
                  const fill = Number(r.PfShares) || 0;
                  const shares = hold > 0 ? hold : fill;
                  if (shares > 0)
                    return sum + truncateShareUsdtAmount(shares) * fx;
                  const notional = Number(r.PfNotionalUsdt) || Number(r.BetMoney) || 0;
                  const book = Number(r.PfBookPrice);
                  if (notional > 0 && book > 0 && book < 1)
                    return sum + truncateShareUsdtAmount(notional / book) * fx;
                  return sum;
                }
                const odds = Number(r.Odds) || 0;
                return sum + (Number(r.BetMoney) || 0) * odds;
              }, 0);
        }
      }

      this.dayProfit = inDay.reduce((sum, r) => sum + moneyOf(r), 0);
    },

    linkLegend(rows: OrderRow[]) {
      return orderLinkLegend(rows);
    },

    linkClass(rows: OrderRow[]) {
      const total = computeOrderGroupProfit(rows);
      if (total === 0)
        return "default";
      return total > 0 ? "success" : "fail";
    },

    playerLabel(row: OrderRow) {
      const accountStore = useAccountStore();
      const acc = accountStore.findAccount(row.PlayerID);
      if (acc) {
        const platform = accountStore.getPlatformName(acc.platformId, acc.platformName);
        return `${platform} / ${accountOrderDisplayName(acc)}`;
      }
      // 账号已删：后端 Client_GetOrderList 回填 Player（含 soft-delete）
      if (row.Player?.Platform || row.Player?.UserName) {
        const base = `${row.Player.Platform || ""} / ${row.Player.UserName || ""}`.trim();
        return row.PlayerDeleted && base ? `${base}（已删）` : base;
      }
      const pid = Number(row.PlayerID) || 0;
      return pid ? `#${pid}` : "";
    },

    /** 对齐 A8 OrderView：暂停账号平台角标加 `.Stop` 删除线 */
    platformClass(row: OrderRow) {
      const acc = useAccountStore().findAccount(row.PlayerID);
      if (acc?.active)
        return "Stop";
      return undefined;
    },
  },
});

import { computed, onUnmounted, ref } from "vue";
import type { OrderRow } from "@/types/order";
import type { OrderListSource } from "../orderListTypes";
import { useOddsStore } from "@/stores/oddsStore";
import { useSportOddsStore } from "@/stores/sportOddsStore";
import { PLATFORMS } from "@changmen/venue-browser/adapter/shared";
import { resolvePmRemainingShares } from "@changmen/venue-browser/polymarket";
import { clobPriceFromDecimalOdds, clobPriceFromFoOddsEntry, formatPolymarketApiDecimal,
  isPmBuyOrderListRow, isPmManuallySoldBuy, pmBuyLifecycleTagText, pmOddsTextFromClobPrice,
  pmOrderOddsText, pmUnrealizedPnlAtLiveCny, formatLiveUnrealizedPnlText } from "@/shared/pmOrderDisplay";
import { isPfBuyOrderListRow, isPfManuallySoldBuy, pfBuyLifecycleTagText, pfOddsTextFromClobPrice,
  pfOrderOddsText, pfUnrealizedPnlAtLiveCny } from "@/shared/pfOrderDisplay";

/** Read-only order quotes; subscribe synchronously and release both subscriptions on unmount. */
export function useOrderListLiveQuotes(props: OrderListSource) {
  let stopOddsLiveWatch: (() => void) | undefined;
  let stopSportLiveWatch: (() => void) | undefined;
  const oddsStore = useOddsStore();
  const sportOddsStore = useSportOddsStore();

  /**
   * [changmen 扩展] 订单现价局部时钟：仅当 fo/sportOdds 写入**挂单相关** token 时 bump。
   * 不再订阅全局 quoteTick / sportOdds.tick（任意盘口变价会拖整栏重算）。
   */
  const orderLiveTick = ref(0);

  function liveTokenKey(platform: string, tokenId: string): string {
    return `${platform}:${tokenId}`;
  }

  /** 当前列表里需要盯现价的 PM/PF token */
  const watchedLiveTokens = computed(() => {
    const set = new Set<string>();
    for (const [, rows] of props.orderEntries) {
      for (const row of rows) {
        if (pmShowLivePrice(row)) {
          const t = String(row.PmTokenId ?? "").trim();
          if (t)
            set.add(liveTokenKey(PLATFORMS.Polymarket, t));
        }
        if (pfShowLivePrice(row)) {
          const t = String(row.PfTokenId ?? "").trim();
          if (t)
            set.add(liveTokenKey(PLATFORMS.PredictFun, t));
        }
      }
    }
    return set;
  });

  function bumpOrderLiveIfWatched(platform: unknown, oddId: unknown) {
    const id = String(oddId ?? "").trim();
    if (!id)
      return;
    if (watchedLiveTokens.value.has(liveTokenKey(String(platform), id)))
      orderLiveTick.value += 1;
  }

  // 在 setup 同步订阅（勿等 onMounted）：避免首屏到 mount 之间漏掉 fo/sport 写入
  stopOddsLiveWatch = oddsStore.$onAction(({ name, args, after }) => {
    after(() => {
      if (name === "save") {
        const entry = args[1] as { id?: unknown } | undefined;
        bumpOrderLiveIfWatched(args[0], entry?.id);
        return;
      }
      if (name === "updateOddsLock") {
        bumpOrderLiveIfWatched(args[0], args[1]);
        return;
      }
      if (name === "clean" && watchedLiveTokens.value.size > 0)
        orderLiveTick.value += 1;
    });
  });

  stopSportLiveWatch = sportOddsStore.$onAction(({ name, args, after }) => {
    after(() => {
      if (name === "save") {
        bumpOrderLiveIfWatched(args[0], args[1]);
        return;
      }
      if (name === "clear" && watchedLiveTokens.value.size > 0)
        orderLiveTick.value += 1;
    });
  });

  /**
   * 未结算买单实时价：只读、不写 fo。
   * 与盘口同源：fo.clobPrice → fo.odds→价；体育盘口价在 sportOddsStore（不进 fo）。
   */
  function pmLiveClobPrice(row: OrderRow): number | null {
    void orderLiveTick.value;
    const tokenId = String(row.PmTokenId ?? "").trim();
    if (!tokenId)
      return null;
    const fromFo = clobPriceFromFoOddsEntry(
      oddsStore.getEntry(PLATFORMS.Polymarket, tokenId),
    );
    if (fromFo != null)
      return fromFo;
    return clobPriceFromDecimalOdds(sportOddsStore.get(PLATFORMS.Polymarket, tokenId));
  }

  /**
   * 可卖持仓显示「当前价」行。
   * 不要求 fo 已有报价（否则首屏/未订阅 token 时连「当前价」字样都没有）；
   * 无 live 时文案为 —，挂单相关 token 入 fo/sportOdds 后填数。
   */
  function pmShowLivePrice(row: OrderRow): boolean {
    if (!isPmBuyOrderListRow(row))
      return false;
    // 仅「部分卖出」仍显示当前价；全卖 / 已结算不显示
    if (pmBuyLifecycleTagText(row) === "已结算")
      return false;
    if (isPmManuallySoldBuy(row)) {
      const state = String(row.PmSellState ?? "").toLowerCase();
      if (!(state === "partial" && resolvePmRemainingShares(row) > 0))
        return false;
    }
    const status = String(row.Status ?? "").trim().toLowerCase();
    if (status === "reject" || status === "return" || status === "pending")
      return false;
    if (row.PmSellState === "closed" || row.PmSellState === "settled")
      return false;
    return true;
  }

  function pmLivePriceText(row: OrderRow): string {
    const live = pmLiveClobPrice(row);
    return live != null ? formatPolymarketApiDecimal(live) : "—";
  }

  function pmLiveUnrealizedPnlCny(row: OrderRow): number | null {
    if (row.DisplayOnly && row.BetMoney == null)
      return null;
    return pmUnrealizedPnlAtLiveCny(row, pmLiveClobPrice(row));
  }

  function pmLiveUnrealizedPnlText(row: OrderRow): string | null {
    return formatLiveUnrealizedPnlText(pmLiveUnrealizedPnlCny(row));
  }

  /** 有 live 才显示「当前赔率」；无 live 时不跟买入赔率冒充 */
  function pmShowLiveOdds(row: OrderRow): boolean {
    return pmShowLivePrice(row) && pmLiveClobPrice(row) != null;
  }

  /** 最后一行赔率：有当前价则跟当前价，否则跟买入价 */
  function pmLastLineOddsText(row: OrderRow): string {
    const live = pmLiveClobPrice(row);
    if (live != null)
      return pmOddsTextFromClobPrice(live);
    return pmOrderOddsText(row);
  }

  function pfLiveClobPrice(row: OrderRow): number | null {
    void orderLiveTick.value;
    const tokenId = String(row.PfTokenId ?? "").trim();
    if (!tokenId)
      return null;
    const fromFo = clobPriceFromFoOddsEntry(
      oddsStore.getEntry(PLATFORMS.PredictFun, tokenId),
    );
    if (fromFo != null)
      return fromFo;
    return clobPriceFromDecimalOdds(sportOddsStore.get(PLATFORMS.PredictFun, tokenId));
  }

  function pfShowLivePrice(row: OrderRow): boolean {
    if (!isPfBuyOrderListRow(row))
      return false;
    // 对齐 PM：全卖 / 已结算不显示当前价
    if (pfBuyLifecycleTagText(row) === "已结算")
      return false;
    if (isPfManuallySoldBuy(row))
      return false;
    const status = String(row.Status ?? "").trim().toLowerCase();
    if (status === "reject" || status === "return" || status === "pending")
      return false;
    if (row.PfSellState === "closed" || row.PfSellState === "settled")
      return false;
    return true;
  }

  function pfLivePriceText(row: OrderRow): string {
    const live = pfLiveClobPrice(row);
    return live != null ? formatPolymarketApiDecimal(live) : "—";
  }

  function pfLiveUnrealizedPnlCny(row: OrderRow): number | null {
    return pfUnrealizedPnlAtLiveCny(row, pfLiveClobPrice(row));
  }

  function pfLiveUnrealizedPnlText(row: OrderRow): string | null {
    return formatLiveUnrealizedPnlText(pfLiveUnrealizedPnlCny(row));
  }

  function pfShowLiveOdds(row: OrderRow): boolean {
    return pfShowLivePrice(row) && pfLiveClobPrice(row) != null;
  }

  function pfLastLineOddsText(row: OrderRow): string {
    const live = pfLiveClobPrice(row);
    if (live != null)
      return pfOddsTextFromClobPrice(live);
    return pfOrderOddsText(row);
  }

  onUnmounted(() => {
    stopOddsLiveWatch?.();
    stopOddsLiveWatch = undefined;
    stopSportLiveWatch?.();
    stopSportLiveWatch = undefined;
  });

  return { pmShowLivePrice, pmLivePriceText, pmLiveUnrealizedPnlCny, pmLiveUnrealizedPnlText, pmShowLiveOdds, pmLastLineOddsText, pfShowLivePrice, pfLivePriceText, pfLiveUnrealizedPnlCny, pfLiveUnrealizedPnlText, pfShowLiveOdds, pfLastLineOddsText };
}

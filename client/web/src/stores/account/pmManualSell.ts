/**
 * [changmen 扩展] 订单栏 PM 卖出：对当前买单下 FOK，确认到终态后落库。
 * 平仓中（closing）为过渡态；出口只有已平仓 / 未成交可再卖。
 */
import { ElMessage } from "element-plus";
import { shallowRef } from "vue";
import type { PlatformAccount } from "@/models/platformAccount";
import type { VenueOrder } from "@changmen/venue-adapter/contract";
import {
  awaitPolymarketManualSellFinalOutcome,
  hasOpenPolymarketPosition,
  resolvePmRemainingShares,
  sellPolymarketBuyPosition,
} from "@changmen/venue-adapter/polymarket";
import { saveOrders } from "@/api/order";
import { groupOrdersByEffectiveLink } from "@/shared/orderLink";
import { formatPolymarketApiDecimal } from "@/shared/pmOrderDisplay";
import { useAccountStore } from "@/stores/accountStore";
import { useOrderStore } from "@/stores/orderStore";
import type { OrderRow } from "@/types/order";

type ClosingEntry = {
  sellOrderId: string;
  at: number;
  fallbackPrice?: number;
  sharesWanted?: number;
};

/** 飞行中 / 确认框中：响应式，供按钮 disabled */
const sellingOrderIds = shallowRef(new Set<string>());
/** 平仓确认中：买单 → 卖单号（session 内跨刷新保留） */
const CLOSING_KEY = "pmManualSell.closing";
const closingByBuyId = shallowRef(loadClosing());
/** resume 防重入 */
let resumeInFlight = false;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleResumePmManualSellClosings(delayMs = 5_000): void {
  if (resumeTimer)
    return;
  resumeTimer = setTimeout(() => {
    resumeTimer = null;
    void resumePmManualSellClosings();
  }, delayMs);
}

function loadClosing(): Map<string, ClosingEntry> {
  const map = new Map<string, ClosingEntry>();
  try {
    const raw = sessionStorage.getItem(CLOSING_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, ClosingEntry | string>;
      for (const [buyId, v] of Object.entries(obj)) {
        const id = String(buyId ?? "").trim();
        if (!id)
          continue;
        if (typeof v === "string") {
          const sellId = v.trim();
          if (sellId)
            map.set(id, { sellOrderId: sellId, at: Date.now() });
          continue;
        }
        const sellId = String(v?.sellOrderId ?? "").trim();
        if (sellId) {
          map.set(id, {
            sellOrderId: sellId,
            at: Number(v?.at) || Date.now(),
            fallbackPrice: Number(v?.fallbackPrice) > 0 ? Number(v.fallbackPrice) : undefined,
            sharesWanted: Number(v?.sharesWanted) > 0 ? Number(v.sharesWanted) : undefined,
          });
        }
      }
    }
  }
  catch { /* ignore */ }

  return map;
}

function writeClosing(map: Map<string, ClosingEntry>): void {
  try {
    const obj: Record<string, ClosingEntry> = {};
    for (const [k, v] of map)
      obj[k] = v;
    sessionStorage.setItem(CLOSING_KEY, JSON.stringify(obj));
  }
  catch { /* ignore quota */ }
}

function setClosingMap(next: Map<string, ClosingEntry>): void {
  closingByBuyId.value = next;
  writeClosing(next);
}

function enterClosing(
  buyOrderId: string,
  sellOrderId: string,
  opts?: { fallbackPrice?: number; sharesWanted?: number },
): void {
  const id = String(buyOrderId ?? "").trim();
  const sellId = String(sellOrderId ?? "").trim();
  if (!id)
    return;
  const next = new Map(closingByBuyId.value);
  next.set(id, {
    sellOrderId: sellId,
    at: Date.now(),
    fallbackPrice: opts?.fallbackPrice,
    sharesWanted: opts?.sharesWanted,
  });
  setClosingMap(next);
}

function clearClosing(buyOrderId: string): void {
  const id = String(buyOrderId ?? "").trim();
  if (!id || !closingByBuyId.value.has(id))
    return;
  const next = new Map(closingByBuyId.value);
  next.delete(id);
  setClosingMap(next);
}

function setHas(refSet: typeof sellingOrderIds, id: string): boolean {
  return refSet.value.has(id);
}

function addId(refSet: typeof sellingOrderIds, id: string): void {
  if (refSet.value.has(id))
    return;
  const next = new Set(refSet.value);
  next.add(id);
  refSet.value = next;
}

function removeId(refSet: typeof sellingOrderIds, id: string): void {
  if (!refSet.value.has(id))
    return;
  const next = new Set(refSet.value);
  next.delete(id);
  refSet.value = next;
}

function venueOrdersToLocalRows(buyRow: OrderRow, orders: VenueOrder[]): OrderRow[] {
  const playerId = Number(buyRow.PlayerID) || 0;
  const link = Number(buyRow.Link) || Number(orders.find(o => o.link)?.link) || 0;
  return orders.map((vo) => {
    if (vo.pmSide === "sell") {
      return {
        OrderID: vo.orderId,
        Link: vo.link ?? link,
        Type: "Polymarket",
        Match: vo.match,
        Bet: vo.bet,
        Item: vo.item,
        Odds: vo.odds,
        BetMoney: vo.betMoney,
        Money: vo.money,
        Status: "None",
        CreateAt: vo.createAt,
        PlayerID: playerId,
        PmTokenId: vo.pmTokenId,
        PmShares: vo.pmShares,
        PmFillPrice: vo.pmFillPrice,
        PmStakeUsdc: vo.pmStakeUsdc,
        PmConditionId: vo.pmConditionId,
        PmOrigin: vo.pmOrigin,
        PmRealizedPnlUsdc: vo.pmRealizedPnlUsdc,
        PmSide: "sell",
        PmBuyOrderId: vo.pmBuyOrderId ?? String(buyRow.OrderID ?? ""),
      } satisfies OrderRow;
    }
    return {
      ...buyRow,
      Money: vo.money,
      PmStakeUsdc: vo.pmStakeUsdc,
      PmAttributedSellShares: vo.pmAttributedSellShares,
      PmSellState: vo.pmSellState,
      PmRealizedPnlUsdc: vo.pmRealizedPnlUsdc,
      PmSellProceeds: vo.pmSellProceeds,
      PmLastSellOrderId: vo.pmLastSellOrderId,
      PmSide: "buy",
      PmOrigin: vo.pmOrigin ?? buyRow.PmOrigin,
      PositionEvents: mergePositionEventsLocal(buyRow.PositionEvents, vo.positionEvents),
    } satisfies OrderRow;
  });
}

type PositionSellEvent = NonNullable<NonNullable<OrderRow["PositionEvents"]>["sells"]>[number];

function mergePositionEventsLocal(
  prev: OrderRow["PositionEvents"] | undefined,
  incoming: VenueOrder["positionEvents"] | undefined,
): OrderRow["PositionEvents"] | undefined {
  const byId = new Map<string, PositionSellEvent>();
  for (const e of prev?.sells ?? []) {
    const id = String(e?.id ?? "").trim();
    if (!id)
      continue;
    byId.set(id.toLowerCase(), { ...e, id });
  }
  for (const e of incoming?.sells ?? []) {
    const id = String(e?.id ?? "").trim();
    if (!id)
      continue;
    const key = id.toLowerCase();
    byId.set(key, { ...byId.get(key), ...e, id });
  }
  if (!byId.size)
    return prev;
  return {
    sells: [...byId.values()].sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0)),
  };
}

/** 落库失败时先改本地，避免按钮仍可卖 */
function applyManualSellOrdersLocally(buyRow: OrderRow, ordersToSave: VenueOrder[]): void {
  const orderStore = useOrderStore();
  const byId = new Map<string, OrderRow>();
  for (const rows of orderStore.orders.values()) {
    for (const row of rows)
      byId.set(String(row.OrderID ?? ""), row);
  }
  for (const local of venueOrdersToLocalRows(buyRow, ordersToSave)) {
    const id = String(local.OrderID ?? "").trim();
    if (!id)
      continue;
    byId.set(id, local);
  }
  orderStore.orders = groupOrdersByEffectiveLink([...byId.values()]);
}

async function persistFilledSell(
  account: PlatformAccount,
  buyRow: OrderRow,
  ordersToSave: VenueOrder[],
): Promise<boolean> {
  try {
    await saveOrders(account, ordersToSave);
    return true;
  }
  catch (saveErr) {
    try {
      await saveOrders(account, ordersToSave);
      return true;
    }
    catch {
      // 勿立刻 fetchOrders：会冲掉本地乐观已平仓，导致按钮可再卖 → 双卖
      applyManualSellOrdersLocally(buyRow, ordersToSave);
      ElMessage.error(
        `链上已平仓，但订单落库失败：${saveErr instanceof Error ? saveErr.message : String(saveErr)}。已按已平仓展示，请稍后刷新。`,
      );
      return false;
    }
  }
}

export function isPmManualSellClosing(orderId: string | number | undefined): boolean {
  return closingByBuyId.value.has(String(orderId ?? "").trim());
}

/** 供自动卖（arb）写入平仓中会话，落库失败时可 resume */
export function trackPmManualSellClosing(
  buyOrderId: string,
  info: { sellOrderId: string; fallbackPrice?: number; sharesWanted?: number },
): void {
  enterClosing(buyOrderId, info.sellOrderId, {
    fallbackPrice: info.fallbackPrice,
    sharesWanted: info.sharesWanted,
  });
}

export function clearPmManualSellClosing(buyOrderId: string): void {
  clearClosing(buyOrderId);
}

export function canManualSellPmBuy(row: OrderRow): boolean {
  const orderId = String(row.OrderID ?? "").trim();
  if (!orderId)
    return false;
  if (isPmManualSellClosing(orderId))
    return false;
  if (String(row.Type ?? "").trim() !== "Polymarket")
    return false;
  if (row.PmSide === "sell")
    return false;
  if (!String(row.PmTokenId ?? "").trim())
    return false;
  if (resolvePmRemainingShares(row) <= 0.0001)
    return false;
  return hasOpenPolymarketPosition(row);
}

export function isPmManualSellInFlight(orderId: string | number | undefined): boolean {
  const id = String(orderId ?? "").trim();
  return setHas(sellingOrderIds, id) || isPmManualSellClosing(id);
}

async function applyFinalFilled(
  buyRow: OrderRow,
  account: PlatformAccount,
  ordersToSave: VenueOrder[],
  sharesSold: number,
  sharesWanted: number,
  partialFill: boolean,
): Promise<void> {
  const orderId = String(buyRow.OrderID ?? "").trim();
  const saved = await persistFilledSell(account, buyRow, ordersToSave);
  if (!saved) {
    // 落库失败：已 toast error + 本地乐观已平仓 + 保留 closing；勿再报成功
    return;
  }
  clearClosing(orderId);
  try {
    await useOrderStore().fetchOrders();
  }
  catch { /* ignore */ }
  const sharesText = formatPolymarketApiDecimal(sharesWanted);
  if (partialFill) {
    ElMessage.warning(
      `仅成交 ${formatPolymarketApiDecimal(sharesSold)} / ${sharesText} 份（已平仓写入）`,
    );
  }
  else {
    ElMessage.success(`已平仓 ${formatPolymarketApiDecimal(sharesSold)} 份`);
  }
}

/**
 * 刷新后恢复：对 session 内仍「平仓中」的买单跑完终态确认。
 */
export async function resumePmManualSellClosings(): Promise<void> {
  if (resumeInFlight)
    return;
  const entries = [...closingByBuyId.value.entries()];
  if (!entries.length)
    return;

  resumeInFlight = true;
  const orderStore = useOrderStore();
  const accountStore = useAccountStore();
  try {
    const byId = new Map<string, OrderRow>();
    for (const rows of orderStore.orders.values()) {
      for (const row of rows)
        byId.set(String(row.OrderID ?? ""), row);
    }

    for (const [buyId, entry] of entries) {
      // 正在卖出流程中：勿并发 resume
      if (setHas(sellingOrderIds, buyId))
        continue;

      const row = byId.get(buyId);
      if (!row) {
        clearClosing(buyId);
        continue;
      }
      if (!entry.sellOrderId) {
        clearClosing(buyId);
        continue;
      }
      // 已落库 closed：直接清会话
      if (String(row.PmSellState ?? "").toLowerCase() === "closed"
        || resolvePmRemainingShares(row) <= 0.0001) {
        clearClosing(buyId);
        continue;
      }

      const account = accountStore.findAccount(Number(row.PlayerID));
      if (!account?.token) {
        // 账号暂不可用：保留 closing，下次再 resume
        continue;
      }

      addId(sellingOrderIds, buyId);
      try {
        const final = await awaitPolymarketManualSellFinalOutcome({
          account,
          buyRow: row,
          sellOrderId: entry.sellOrderId,
          fallbackPrice: entry.fallbackPrice,
          sharesWanted: entry.sharesWanted,
        });
        if (final.outcome === "filled") {
          const saved = await persistFilledSell(account, row, final.ordersToSave);
          if (saved) {
            clearClosing(buyId);
            try {
              await orderStore.fetchOrders();
            }
            catch { /* ignore */ }
          }
          // 落库失败：保留 closing 下次再试
        }
        else if (final.outcome === "unfilled") {
          clearClosing(buyId);
        }
        else {
          // pending：保留 closing，并退避续查；绝不重新开放卖出。
          scheduleResumePmManualSellClosings();
        }
      }
      catch {
        // 网络/异常：保留平仓中，下次 fetchOrders 再试（勿清会话以免双卖）
      }
      finally {
        removeId(sellingOrderIds, buyId);
      }
    }
  }
  finally {
    resumeInFlight = false;
  }
}

export async function confirmAndSellPmBuyOrder(row: OrderRow): Promise<boolean> {
  const orderId = String(row.OrderID ?? "").trim();
  if (!orderId || !canManualSellPmBuy(row))
    return false;
  if (setHas(sellingOrderIds, orderId))
    return false;

  addId(sellingOrderIds, orderId);
  try {
    const shares = resolvePmRemainingShares(row);
    const sharesText = formatPolymarketApiDecimal(shares);
    const { ElMessageBox } = await import("element-plus");
    try {
      await ElMessageBox.confirm(
        `市价全卖该买单对应份额 ${sharesText}？`,
        "PM 卖出",
        { type: "warning", confirmButtonText: "卖出", cancelButtonText: "取消" },
      );
    }
    catch {
      return false;
    }

    const accountStore = useAccountStore();
    const account = accountStore.findAccount(Number(row.PlayerID));
    if (!account?.token) {
      ElMessage.error("找不到对应 Polymarket 账号");
      return false;
    }

    const result = await sellPolymarketBuyPosition({
      account,
      buyRow: row,
      onSubmitted: (info) => {
        enterClosing(orderId, info.sellOrderId, {
          fallbackPrice: info.fallbackPrice,
          sharesWanted: info.sharesWanted,
        });
      },
    });

    if (result.ok && result.ordersToSave?.length) {
      await applyFinalFilled(
        row,
        account,
        result.ordersToSave,
        result.sharesSold ?? shares,
        shares,
        Boolean(result.partialFill),
      );
      return true;
    }

    if (result.unfilled) {
      clearClosing(orderId);
      ElMessage.warning(result.error ?? "未成交，可重新卖出");
      return false;
    }

    if (result.pending && result.sellOrderId) {
      ElMessage.warning(result.error ?? "卖单仍待场馆确认，已保持平仓中");
      scheduleResumePmManualSellClosings();
      return false;
    }

    // 异常仍带 sellOrderId：再跑终态，保证离开平仓中
    if (result.sellOrderId) {
      const closing = closingByBuyId.value.get(orderId);
      enterClosing(orderId, result.sellOrderId, {
        fallbackPrice: closing?.fallbackPrice,
        sharesWanted: closing?.sharesWanted ?? shares,
      });
      const final = await awaitPolymarketManualSellFinalOutcome({
        account,
        buyRow: row,
        sellOrderId: result.sellOrderId,
        fallbackPrice: closing?.fallbackPrice,
        sharesWanted: closing?.sharesWanted ?? shares,
      });
      if (final.outcome === "filled") {
        await applyFinalFilled(
          row,
          account,
          final.ordersToSave,
          final.sharesSold,
          shares,
          final.partialFill,
        );
        return true;
      }
      if (final.outcome === "pending") {
        ElMessage.warning(final.reason || "卖单仍待场馆确认，已保持平仓中");
        scheduleResumePmManualSellClosings();
        return false;
      }
      clearClosing(orderId);
      ElMessage.warning(final.reason || "未成交，可重新卖出");
      return false;
    }

    clearClosing(orderId);
    ElMessage.error(result.error ?? "卖出失败");
    return false;
  }
  catch (err) {
    // 若已进入 closing（有卖单号），保留会话等 resume；否则清掉
    const closing = closingByBuyId.value.get(orderId);
    if (!closing?.sellOrderId)
      clearClosing(orderId);
    ElMessage.error(err instanceof Error ? err.message : String(err));
    return false;
  }
  finally {
    removeId(sellingOrderIds, orderId);
  }
}

/**
 * [changmen 扩展] 订单栏 PF 卖出：浏览器自签 MARKET FOK → VPS 中继。
 */
import { ElMessage } from "element-plus";
import { shallowRef } from "vue";
import type { OrderRow } from "@/types/order";
import {
  pfSubmitSignedSell,
  signPredictFunUserMarketSell,
} from "@changmen/venue-browser/adapter/predictfun";
import { useAccountStore } from "@/stores/accountStore";
import { useOrderStore } from "@/stores/orderStore";

const sellingOrderIds = shallowRef(new Set<string>());

function setHas(refSet: typeof sellingOrderIds, id: string): boolean {
  return refSet.value.has(id);
}

function addId(refSet: typeof sellingOrderIds, id: string): void {
  const next = new Set(refSet.value);
  next.add(id);
  refSet.value = next;
}

function removeId(refSet: typeof sellingOrderIds, id: string): void {
  const next = new Set(refSet.value);
  next.delete(id);
  refSet.value = next;
}

export function canManualSellPfBuy(row: OrderRow): boolean {
  const orderId = String(row.OrderID ?? "").trim();
  if (!orderId)
    return false;
  if (String(row.Type ?? "").trim() !== "PredictFun")
    return false;
  if (row.PfSide === "sell")
    return false;
  if (row.PfSellState === "closed" || row.PfSellState === "settled")
    return false;
  const st = String(row.Status ?? "None");
  if (st !== "None")
    return false;
  const hold = Number(row.PfHoldShares);
  if (!(Number.isFinite(hold) && hold > 0))
    return false;
  const marketId = String(row.PfMarketId ?? "").trim();
  const tokenId = String(row.PfTokenId ?? "").trim();
  if (!marketId || !tokenId)
    return false;
  return true;
}

export function isPfManualSellInFlight(orderId: string | number | undefined): boolean {
  return setHas(sellingOrderIds, String(orderId ?? "").trim());
}

export async function confirmAndSellPfBuyOrder(row: OrderRow): Promise<boolean> {
  const orderId = String(row.OrderID ?? "").trim();
  if (!orderId || !canManualSellPfBuy(row))
    return false;
  if (setHas(sellingOrderIds, orderId))
    return false;

  addId(sellingOrderIds, orderId);
  try {
    const { ElMessageBox } = await import("element-plus");
    try {
      await ElMessageBox.confirm(
        "市价全卖该买单对应份额？（自有账号签名，回款进链上 USDT）",
        "PredictFun 卖出",
        { type: "warning", confirmButtonText: "卖出", cancelButtonText: "取消" },
      );
    }
    catch {
      return false;
    }

    const accountStore = useAccountStore();
    const account = accountStore.findAccount(Number(row.PlayerID));
    if (!account?.accountId) {
      ElMessage.error("找不到对应 PredictFun 账号");
      return false;
    }

    const marketId = String(row.PfMarketId ?? "").trim();
    const tokenId = String(row.PfTokenId ?? "").trim();
    const holdShares = Number(row.PfHoldShares);
    const signed = await signPredictFunUserMarketSell({
      account,
      marketId,
      tokenId,
      holdShares,
      feeRateBps: Number(row.PfFeeRateBps) >= 0 ? Number(row.PfFeeRateBps) : undefined,
    });

    const result = await pfSubmitSignedSell(account, {
      buyOrderId: orderId,
      jwt: signed.jwt,
      createOrderBody: signed.createOrderBody,
      orderHash: signed.orderHash,
      bookPrice: signed.bookPrice,
      bookOdds: signed.bookOdds,
      proceedsUsdt: signed.proceedsUsdt,
      sharesWei: signed.sharesWei,
      feeRateBps: signed.feeRateBps,
    });
    await useOrderStore().fetchOrders();
    try {
      await accountStore.refreshBalance(account);
    }
    catch {
      /* ignore */
    }
    ElMessage.success(
      `已卖出，回款 ${Number(result.proceedsUsdt ?? 0).toFixed(2)} USDT`,
    );
    return true;
  }
  catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err));
    return false;
  }
  finally {
    removeId(sellingOrderIds, orderId);
  }
}

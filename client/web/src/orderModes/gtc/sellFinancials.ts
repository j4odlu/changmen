import type { VenueOrder } from "@changmen/venue-adapter/contract";
import type { PlatformAccount } from "@/models/platformAccount";
import { Currency, getExchange } from "@changmen/shared/currency";
import { readGtcSellCash } from "@changmen/venue-adapter/polymarket/gtc";

/** [changmen 扩展] 卖出回款已含卖出手续费；买入含费成本由服务端原单校准。 */
export async function reconcileGtcSellFinancials(account: PlatformAccount, orders: VenueOrder[]): Promise<VenueOrder[]> {
  const result = orders.map(row => ({ ...row }));
  for (const sell of result.filter(row => row.provider === "Polymarket" && row.pmSide === "sell"
    && (row as VenueOrder & { pmGtcExecutionId?: string }).pmGtcExecutionId)) {
    const cash = await readGtcSellCash(account, sell);
    const fx = getExchange(Currency.USDT);
    const buy = result.find(row => row.orderId.toLowerCase() === sell.pmBuyOrderId?.toLowerCase());
    const event = buy?.positionEvents?.sells?.find(event => event.id.toLowerCase() === sell.orderId.toLowerCase());
    // 公共卖单 CNY 镜像可能已取两位；差额必须用该次原币流水核对。
    const delta = cash - (event?.proceeds ?? sell.betMoney / fx);
    sell.betMoney = cash * fx;
    sell.pmRealizedPnlUsdc = Math.round((cash - (Number(sell.pmStakeUsdc) || 0)) * 10000) / 10000;
    if (!buy) continue; // 服务端也支持仅卖单重试，按本卖单流水校准原买单。
    buy.pmSellProceeds = Math.round(((Number(buy.pmSellProceeds) || 0) + delta) * 10000) / 10000;
    buy.pmRealizedPnlUsdc = Math.round(((Number(buy.pmRealizedPnlUsdc) || 0) + delta) * 10000) / 10000;
    buy.money = Math.round(buy.pmRealizedPnlUsdc * fx * 10000) / 10000;
    if (buy.positionEvents) buy.positionEvents = { ...buy.positionEvents,
      sells: buy.positionEvents.sells?.map(event => event.id.toLowerCase() === sell.orderId.toLowerCase()
        ? { ...event, proceeds: cash, pnl: sell.pmRealizedPnlUsdc } : event) };
  }
  return result;
}

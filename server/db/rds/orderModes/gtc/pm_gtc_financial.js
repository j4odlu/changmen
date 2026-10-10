import { scaleUsdtToCnyDisplay } from "@changmen/shared/currency";
/** [changmen 扩展] 校验普通 PM 助手输出与原单事实的对应关系，不另算财务值。 */
import { gtcUnits } from "@changmen/shared/pm_gtc";

export function resolveGtcFinancialOrder(row, incoming) {
  if (!row.orderId || row.fee == null || (!row.complete && !Object.values(row.fills).some(fill => fill.status === "FAILED")))
    return;
  const source = incoming ?? row.financialOrder;
  if (!source)
    return; // 旧客户端没有普通助手结果；保留事实，刷新后由新客户端补齐。
  const values = [source.pmShares, source.pmFillPrice, source.pmStakeUsdc, source.pmFeeUsdc, source.odds, source.betMoney];
  const shares = Number(row.matched);
  const matches = values.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0)
    && gtcUnits(String(source.pmShares)) === gtcUnits(row.matched)
    && Math.abs(source.pmFeeUsdc - Number(row.fee)) <= 0.000051
    && Math.abs(source.pmStakeUsdc - Number(row.principal) - Number(row.fee)) <= 0.000151
    && Math.abs(source.betMoney - scaleUsdtToCnyDisplay(source.pmStakeUsdc)) <= 0.000001
    && (shares > 0
      ? source.pmFillPrice > 0 && source.pmFillPrice < 1
      && Math.abs(source.pmFillPrice - Number(row.principal) / shares) <= 0.000061
      && source.odds > 1
      : values.every(value => value === 0));
  if (!matches) {
    if (incoming)
      throw new Error("GTC 普通订单结果与成交事实不一致");
    return; // 新事实已改变旧结果，不把缓存金额用于新累计成交。
  }
  return { pmShares: source.pmShares, pmFillPrice: source.pmFillPrice, pmStakeUsdc: source.pmStakeUsdc, pmFeeUsdc: source.pmFeeUsdc, odds: source.odds, betMoney: source.betMoney };
}

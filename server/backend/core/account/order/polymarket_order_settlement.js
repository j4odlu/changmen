/**
 * PM 订单入库前的最终结算保护（纯计算，不查询市场或数据库）。
 * 输入是保存流程已合并的订单；Money / betMoney 为 CNY。
 * 份额与 pmStakeUsdc / pmRealizedPnlUsdc 仍为场馆原单位。
 */
import { Currency, getExchange } from "@changmen/shared/currency";
import { polymarketIsEqualSplitOrder, polymarketProfitStatus, polymarketVerifiedOrderPayout } from "@changmen/shared/pm_settlement";
import { parseNum } from "./order_values.js";

export function mergePolymarketSettlementForSave({ prevRow, prevRaw, incoming, raw, money, betMoney }) {
  // Do not mutate caller snapshots: other persistence policies still use them.
  let merged = { ...raw };
  const isSell = String(incoming.pmSide ?? prevRaw.pmSide ?? "buy").toLowerCase() === "sell";
  const preserveFinalSettlement = !isSell && ((polymarketIsEqualSplitOrder(prevRaw) && !polymarketIsEqualSplitOrder(incoming))
    || (polymarketVerifiedOrderPayout(prevRaw) !== undefined && polymarketVerifiedOrderPayout(incoming) === undefined));
  if (preserveFinalSettlement) {
    money = parseNum(prevRow?.money ?? prevRaw.money, money);
    betMoney = parseNum(prevRow?.bet_money ?? prevRaw.betMoney, betMoney);
    merged = { ...merged, pmMatchResult: prevRaw.pmMatchResult, pmSellState: prevRaw.pmSellState,
      status: prevRow?.status ?? prevRaw.status, money, reward: prevRaw.reward, betMoney };
    // Keep the evidence and its calculation inputs together on a late stale write.
    for (const field of ["pmSettlement", "pmStakeUsdc", "pmFeeUsdc", "pmShares", "pmFillPrice", "pmTokenId", "pmConditionId",
      "pmAttributedSellShares", "pmRealizedPnlUsdc", "pmSellProceeds", "pmLastSellOrderId"]) {
      if (Object.prototype.hasOwnProperty.call(prevRaw, field)) merged[field] = prevRaw[field];
      else delete merged[field];
    }
  }
  else if (!isSell && polymarketIsEqualSplitOrder(incoming)) {
    merged.pmMatchResult = "equal_split";
    if (prevRaw.pmSellState === "closed") {
      money = parseNum(prevRow?.money ?? prevRaw.money, money);
      merged.money = money;
      merged.pmSellState = "closed";
    }
    else {
      // A genuine final zero must override the partial-sale zero-write guard.
      money = parseNum(incoming.money ?? incoming.Money, money);
      merged.money = money;
      merged.status = polymarketProfitStatus(money);
      merged.pmSellState = "settled";
    }
  }

  if (!isSell && !preserveFinalSettlement && !polymarketIsEqualSplitOrder(merged)) {
    const st = String(merged.status ?? incoming.status ?? prevRow?.status ?? "").toLowerCase();
    const sellState = String(merged.pmSellState ?? prevRaw.pmSellState ?? "").toLowerCase();
    const attr = parseNum(merged.pmAttributedSellShares ?? prevRaw.pmAttributedSellShares, 0);
    const shares = parseNum(merged.pmShares ?? prevRaw.pmShares, 0);
    const bet = betMoney > 0 ? betMoney : parseNum(merged.betMoney, 0);
    const noSellProgress = attr <= 0.0001 && sellState !== "partial" && sellState !== "closed";
    const officialPrice = polymarketVerifiedOrderPayout(merged);
    if (noSellProgress && bet > 0 && shares > 0 && (officialPrice !== undefined || st === "win" || st === "lose" || st === "lost")) {
      const fx = getExchange(Currency.USDT);
      const payoutPrice = officialPrice ?? (st === "win" ? 1 : 0);
      const fair = shares * payoutPrice * fx - bet;
      const fairRounded = Math.round(fair * 10000) / 10000;
      // Orders without official receipts keep the existing FOK display rounding.
      if (officialPrice !== undefined || Math.round(Number(money) || 0) !== Math.round(fairRounded)) {
        money = fairRounded;
        merged.money = fairRounded;
        if (officialPrice !== undefined) merged.status = polymarketProfitStatus(money);
        if (officialPrice !== undefined || st === "win")
          merged.reward = Math.round(shares * payoutPrice * fx * 10000) / 10000;
      }
    }
  }
  return { raw: merged, money, bet_money: betMoney };
}

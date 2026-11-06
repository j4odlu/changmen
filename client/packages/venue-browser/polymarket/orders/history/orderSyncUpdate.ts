/**
 * PM 订单同步更新：已保存的 CNY 订单 + 本轮 USDC 成交/市场快照 → USDC 订单。
 * 盘口标签由外层传入；不读网络、标签缓存、账号或 localStorage，不写订单。
 */
import type { VenueOrder } from "@changmen/client-core/contract";
import { getExchange, Currency } from "@changmen/shared/currency";
import { polymarketConditionsAgree, polymarketMarketHasAsset } from "@changmen/shared/pm_market_assets";
import { polymarketIsEqualSplitOrder, polymarketVerifiedOrderPayout, polymarketFinalPayout } from "@changmen/shared/pm_settlement";
import type { PolymarketRawMarket } from "../../markets/parse";
import { resolvePmFillShares, resolvePmRemainingShares } from "../positions/pmLogicalPosition";
import { resolvePolymarketSettlement, settlePolymarketEqualSplitOrder } from "./orderMarketSettlement";
import { round4 } from "./orderTradeAmounts";

/** RDS 侧栏行（CNY）→ 同步更新使用的 USDC VenueOrder */
function storedVenueOrderToUsdc(stored: VenueOrder): VenueOrder {
  const stakeUsdc = Number(stored.pmStakeUsdc) || 0;
  const betUsdc = round4((Number(stored.betMoney) || 0) / getExchange(Currency.USDT));
  const sellState = String(stored.pmSellState ?? "").toLowerCase();
  const finalPrice = polymarketVerifiedOrderPayout(stored);
  // The stored DTO reconstructs reward in CNY. Never scale that value a second
  // time, or use nominal full-position odds as a verified remaining payout.
  const reward = stored.pmSide !== "sell" && finalPrice !== undefined
    ? round4(resolvePmRemainingShares(stored) * finalPrice)
    : round4((Number(stored.reward) || 0) / getExchange(Currency.USDT));
  // 原始 betMoney 始终换算保留；剩余敞口只看 pmStakeUsdc
  let nextStake = stakeUsdc;
  if (stored.pmSide !== "sell" && nextStake <= 0 && sellState !== "closed" && sellState !== "settled")
    nextStake = betUsdc;
  return {
    ...stored,
    pmOrigin: "changmen",
    betMoney: betUsdc,
    reward,
    money: round4((Number(stored.money) || 0) / getExchange(Currency.USDT)),
    pmStakeUsdc: nextStake,
  };
}

/**
 * 份额已全部归因卖出时，不再写 Gamma 赛果（盈亏已在买单 money）。
 * 例外：pmSellState 仍为 open 但 attr 已满 — 数据不一致，允许 Gamma 结算。
 */
export function changmenSoldOutBlocksGammaSettlement(order: VenueOrder): boolean {
  const remaining = resolvePmRemainingShares(order);
  if (remaining > 0.0001)
    return false;
  const attributed = order.pmAttributedSellShares ?? 0;
  if (order.pmSellState === "open" && attributed > 0)
    return false;
  return attributed > 0 || order.pmSellState === "closed";
}

/** changmen 落库行 + CLOB 刷新：绑定/成本以 RDS 为准，成交/赛果以 API 为准 */
export function updateStoredPolymarketOrderFromClob(stored: VenueOrder, clob: VenueOrder, betLabel: string): VenueOrder {
  const base = storedVenueOrderToUsdc(stored);
  const isSell = base.pmSide === "sell" || clob.pmSide === "sell";
  if (isSell) {
    const betUsdc = clob.betMoney > 0 ? clob.betMoney : base.betMoney;
    const costUsdc = base.pmStakeUsdc ?? 0;
    const profitUsdc = costUsdc > 0 && betUsdc > 0
      ? round4(betUsdc - costUsdc)
      : (Number(base.pmRealizedPnlUsdc) || 0);
    return {
      ...base,
      pmSide: "sell",
      pmOrigin: "changmen",
      pmBuyOrderId: base.pmBuyOrderId ?? clob.pmBuyOrderId,
      pmTokenId: base.pmTokenId ?? clob.pmTokenId,
      pmShares: clob.pmShares ?? base.pmShares,
      pmFillPrice: clob.pmFillPrice ?? base.pmFillPrice,
      betMoney: betUsdc,
      odds: clob.odds || base.odds,
      pmStakeUsdc: costUsdc,
      pmRealizedPnlUsdc: profitUsdc,
      money: 0,
      status: base.status !== "none" ? base.status : clob.status,
      match: base.match || clob.match,
      bet: betLabel || clob.bet || base.bet,
      item: base.item || clob.item,
      game: base.game || clob.game,
      link: base.link ?? clob.link,
      createAt: base.createAt || clob.createAt,
    };
  }
  const blockGammaSettlement = changmenSoldOutBlocksGammaSettlement(base);
  if (polymarketVerifiedOrderPayout(base) !== undefined && polymarketVerifiedOrderPayout(clob) === undefined)
    return base;
  // Final 50/50 supersedes an earlier paper winner, and survives later stale/no-result snapshots.
  if (polymarketIsEqualSplitOrder(clob) || polymarketIsEqualSplitOrder(base)) {
    const sameAsset = !!base.pmTokenId && base.pmTokenId === clob.pmTokenId
      && !!base.pmConditionId && !!clob.pmConditionId && polymarketConditionsAgree(base.pmConditionId, clob.pmConditionId);
    if (!sameAsset) return polymarketIsEqualSplitOrder(base) ? settlePolymarketEqualSplitOrder(base) : base;
    return settlePolymarketEqualSplitOrder({ ...base,
      pmShares: Math.max(Number(base.pmShares) || 0, Number(clob.pmShares) || 0),
      pmFeeUsdc: base.pmFeeUsdc ?? clob.pmFeeUsdc,
    }, clob.pmSettlement ?? base.pmSettlement);
  }
  const gammaSettled = clob.status !== "none";
  // 官方 winner 写 settled（隐藏卖出）。
  const officialSettled = clob.pmSellState === "settled";
  const nextSellState = officialSettled && !blockGammaSettlement
    ? "settled"
    : (base.pmSellState ?? clob.pmSellState);

  // 已卖光：保留买单上已累计的卖出盈亏，勿清零
  let nextStatus = blockGammaSettlement ? base.status : (gammaSettled ? clob.status : base.status);
  let nextMoney = blockGammaSettlement ? base.money : (gammaSettled ? clob.money : base.money);
  let nextReward = blockGammaSettlement ? base.reward : (gammaSettled ? clob.reward : base.reward);
  let nextRealizedPnlUsdc = base.pmRealizedPnlUsdc;

  // 假 Reject（delayed 误判）但 CLOB 已有成交份额 → 翻回可卖买单
  const storedReject = String(base.status ?? "").toLowerCase() === "reject";
  const clobFillShares = Number(clob.pmShares) || 0;
  if (!blockGammaSettlement && storedReject && clobFillShares > 0.0001) {
    nextStatus = gammaSettled ? clob.status : "none";
    if (!gammaSettled) {
      nextMoney = 0;
      nextReward = Number(clob.reward) || Number(base.reward) || 0;
    }
  }

  // 赛果与盈亏脱钩：卖光仍写入/刷新 pmMatchResult
  const nextMatchResult = clob.pmMatchResult
    ?? ((clob.status === "win" || clob.status === "lose") ? clob.status : undefined)
    ?? base.pmMatchResult;

  // 赛果结算盈亏：用含费全成本（bet/pmStake），勿用 CLOB 名义 money（否则侧栏买入金额与盈亏差手续费）
  if (!blockGammaSettlement && gammaSettled && (clob.status === "win" || clob.status === "lose")) {
    const remaining = resolvePmRemainingShares(base);
    const fill = Math.max(resolvePmFillShares(base), Number(clob.pmShares) || 0);
    const stakeRaw = Number(base.pmStakeUsdc) || 0;
    const betUsdc = Number(base.betMoney) || 0;
    // bet（含费）通常 ≥ 剩余/名义 stake；优先较大者作为全成本
    const allInStake = betUsdc > stakeRaw + 0.0001 ? betUsdc : (stakeRaw > 0 ? stakeRaw : betUsdc);
    if (remaining > 0.0001 && fill > remaining + 0.0001) {
      const remStake = stakeRaw > 0 ? stakeRaw : allInStake * (remaining / fill);
      // [changmen 扩展] money 可能已含上次价格判定的余仓盈亏，不能再次累加。
      // 优先真实卖出盈亏/回款；旧行只在已有财务输赢时扣除上次余仓结果。
      if (base.pmRealizedPnlUsdc != null && Number.isFinite(Number(base.pmRealizedPnlUsdc))) {
        nextRealizedPnlUsdc = Number(base.pmRealizedPnlUsdc);
      }
      else if (base.pmSellProceeds != null && Number.isFinite(Number(base.pmSellProceeds))) {
        nextRealizedPnlUsdc = round4(Number(base.pmSellProceeds) - (allInStake - remStake));
      }
      else {
        const previousResidual = base.status === "win" ? remaining - remStake
          : base.status === "lose" ? -remStake : 0;
        nextRealizedPnlUsdc = round4((Number(base.money) || 0) - previousResidual);
      }
      let residualPnl = 0;
      if (clob.status === "win") {
        nextReward = round4(remaining);
        residualPnl = round4(nextReward - remStake);
      }
      else {
        nextReward = 0;
        residualPnl = round4(-remStake);
      }
      nextMoney = round4(nextRealizedPnlUsdc + residualPnl);
      nextStatus = clob.status;
    }
    else if (fill > 0.0001 && allInStake > 0) {
      if (clob.status === "win") {
        nextReward = round4(fill);
        nextMoney = round4(nextReward - allInStake);
      }
      else {
        nextReward = 0;
        nextMoney = round4(-allInStake);
      }
      nextStatus = clob.status;
    }
  }

  return {
    ...base,
    pmSide: "buy",
    pmOrigin: "changmen",
    betMoney: base.betMoney > 0 ? base.betMoney : clob.betMoney,
    pmShares: (() => {
      const fill = Math.max(Number(base.pmShares) || 0, Number(clob.pmShares) || 0);
      return fill > 0 ? fill : (base.pmShares ?? clob.pmShares);
    })(),
    pmFillPrice: clob.pmFillPrice ?? base.pmFillPrice,
    pmStakeUsdc: base.pmStakeUsdc ?? clob.pmStakeUsdc,
    pmFeeUsdc: (() => {
      const storedFee = Number(base.pmFeeUsdc);
      if (Number.isFinite(storedFee) && storedFee > 0)
        return storedFee;
      const clobFee = Number(clob.pmFeeUsdc);
      return Number.isFinite(clobFee) && clobFee > 0 ? clobFee : undefined;
    })(),
    pmSellState: nextSellState,
    pmAttributedSellShares: base.pmAttributedSellShares ?? clob.pmAttributedSellShares,
    pmRealizedPnlUsdc: nextRealizedPnlUsdc,
    pmMatchResult: nextMatchResult,
    ...((clob.pmSettlement ?? base.pmSettlement) ? { pmSettlement: clob.pmSettlement ?? base.pmSettlement } : {}),
    odds: base.odds || clob.odds,
    status: nextStatus,
    money: nextMoney,
    reward: nextReward,
    match: base.match || clob.match,
    bet: betLabel || clob.bet || base.bet,
    item: base.item || clob.item,
    game: base.game || clob.game,
    pmConditionId: base.pmConditionId ?? clob.pmConditionId,
    createAt: base.createAt || clob.createAt,
  };
}

/** [changmen 扩展] 已确认买单的赛果不能依赖近期成交列表再次返回该单。 */
export function needsStoredMarketSettlement(order: VenueOrder): boolean {
  return order.pmSide !== "sell"
    && !["reject", "pending"].includes(String(order.status).toLowerCase())
    && Number(order.pmShares) > 0.0001
    && !!String(order.pmTokenId ?? "").trim()
    && polymarketVerifiedOrderPayout(order) === undefined;
}

export function updateStoredPolymarketOrderFromMarket(
  stored: VenueOrder,
  market: PolymarketRawMarket | undefined,
  betLabel: string,
): VenueOrder {
  const base = storedVenueOrderToUsdc(stored);
  if (!needsStoredMarketSettlement(stored)) return base;
  const resolved = resolvePolymarketSettlement(market);
  if (!resolved || !market) return base;
  if (!polymarketConditionsAgree(stored.pmConditionId, market.conditionId, market.condition_id)) return base;
  if (!polymarketMarketHasAsset(market, String(stored.pmTokenId))
    || (resolved.winningAssetId && !polymarketMarketHasAsset(market, resolved.winningAssetId))) return base;
  const settlement = polymarketFinalPayout(market, String(stored.pmTokenId));
  if (resolved.kind === "equal_split") return settlePolymarketEqualSplitOrder(base, settlement);
  // A receipt can only be issued from a final official result, never from a price threshold.
  if (stored.pmSellState === "settled" && resolved.kind === "price") return base;
  const result = stored.pmTokenId === resolved.winningAssetId ? "win" : "lose";
  // 只提供盘口赛果；复用既有全成本/部分卖出/卖光保护，不捏造新成交。
  return updateStoredPolymarketOrderFromClob(stored, {
    ...base, status: result, pmMatchResult: result,
    pmSellState: resolved.kind === "official" ? "settled" : base.pmSellState,
    ...(settlement ? { pmSettlement: settlement } : {}),
  }, betLabel);
}

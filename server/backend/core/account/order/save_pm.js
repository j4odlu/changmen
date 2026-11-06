/**
 * Polymarket 订单入库前的新旧字段合并（成交事实、费用和买卖进度）。
 * 由 mergeOrderLogicalSave 分发；最终结算保护交给 polymarket_order_settlement.js。
 * 本模块不执行数据库写入。
 */
import { Currency, getExchange } from "@changmen/shared/currency";
import { normalizePmMatchResult, parseNum } from "./order_values.js";
import { isPmPendingOrder, validatePmSubmission } from "@changmen/shared/pm_submission";
import { polymarketIsEqualSplitOrder } from "@changmen/shared/pm_settlement";
import { mergePolymarketSettlementForSave } from "./polymarket_order_settlement.js";

/** pmShares = 官方 fill，取 RDS/CLOB/入参 最大值，避免 0 覆盖有效值 */
function preservePmBuyFillShares(prevRaw, o, merged) {
  const prev = parseNum(prevRaw.pmShares, 0);
  const fromOrder = parseNum(o.pmShares ?? o.PmShares, 0);
  const fromMerged = parseNum(merged.pmShares, 0);
  const fill = Math.max(prev, fromOrder, fromMerged);
  return fill > 0 ? fill : undefined;
}

/** pmFillPrice = CLOB trade.price；同步时优先用 API 刷新值 */
function preservePmFillPrice(prevRaw, o, merged) {
  const incoming = parseNum(o.pmFillPrice ?? o.PmFillPrice, 0);
  const fromMerged = parseNum(merged.pmFillPrice, 0);
  const prev = parseNum(prevRaw.pmFillPrice, 0);
  if (incoming > 0 && incoming < 1)
    return incoming;
  if (fromMerged > 0 && fromMerged < 1)
    return fromMerged;
  if (prev > 0 && prev < 1)
    return prev;
  return undefined;
}

/** pmFeeUsdc：优先本次入参（含显式零费用），避免旧估算粘住。 */
function preservePmFeeUsdc(prevRaw, o, merged) {
  const value = o.pmFeeUsdc ?? o.PmFeeUsdc;
  const incoming = value == null || typeof value === "boolean" || String(value).trim() === "" ? NaN : parseNum(value, NaN);
  if (Number.isFinite(incoming) && incoming >= 0)
    return incoming;
  const fromMerged = parseNum(merged.pmFeeUsdc, NaN);
  if (Number.isFinite(fromMerged) && fromMerged > 0)
    return fromMerged;
  const prev = parseNum(prevRaw.pmFeeUsdc, NaN);
  if (Number.isFinite(prev) && prev > 0)
    return prev;
  return undefined;
}

/**
 * @param {object|undefined} prevRow
 * @param {object} prevRaw
 * @param {object} o
 * @param {string|undefined} pmOrigin
 * @param {object} merged
 * @param {number} money
 * @param {number} bet_money
 */
export function mergePolymarketProviderSave(prevRow, prevRaw, o, pmOrigin, merged, money, bet_money) {
  const incomingSide = String(o.pmSide ?? prevRaw.pmSide ?? "buy").toLowerCase();
  const isSell = incomingSide === "sell";
  const isChangmen = pmOrigin === "changmen" || prevRaw.pmOrigin === "changmen";
  const requestedOnly = isPmPendingOrder(prevRow)
    || (String(prevRow?.status).toLowerCase() === "reject" && !(Number(prevRaw.pmShares) > 0)
      && validatePmSubmission(prevRaw.pmSubmission, String(prevRow.order_id), Number(prevRaw.pmSubmission?.accountId)));
  const prevBet = requestedOnly ? 0 : parseNum(prevRaw.betMoney, parseNum(prevRow?.bet_money, 0));
  const incomingBet = parseNum(o.betMoney ?? o.BetMoney, 0);

  merged.pmSide = isSell ? "sell" : "buy";

  if (isSell) {
    const proceedsBet = incomingBet > 0 ? incomingBet : (prevBet > 0 ? prevBet : 0);
    // 卖单 money 恒 0（盈亏在买单）；不再保留历史非零 sell money
    const sellMoney = 0;

    if (isChangmen || prevRaw.pmOrigin === "changmen") {
      merged = {
        ...merged,
        pmSide: "sell",
        pmOrigin: "changmen",
        betMoney: incomingBet > 0 ? incomingBet : (prevBet > 0 ? prevBet : proceedsBet),
        pmBuyOrderId: prevRaw.pmBuyOrderId ?? merged.pmBuyOrderId ?? o.pmBuyOrderId,
        pmRealizedPnlUsdc: merged.pmRealizedPnlUsdc ?? o.pmRealizedPnlUsdc ?? prevRaw.pmRealizedPnlUsdc,
        money: sellMoney,
      };
      bet_money = parseNum(merged.betMoney, proceedsBet);
      money = sellMoney;
      merged.money = sellMoney;
      return { raw: merged, money, bet_money };
    }

    // 官网/CLOB 卖单
    merged = {
      ...merged,
      pmSide: "sell",
      pmOrigin: "external",
      pmBuyOrderId: merged.pmBuyOrderId ?? o.pmBuyOrderId ?? prevRaw.pmBuyOrderId,
      betMoney: incomingBet > 0 ? incomingBet : prevBet,
      pmStakeUsdc: parseNum(merged.pmStakeUsdc ?? o.pmStakeUsdc, parseNum(prevRaw.pmStakeUsdc, 0)),
      pmRealizedPnlUsdc: merged.pmRealizedPnlUsdc ?? o.pmRealizedPnlUsdc ?? prevRaw.pmRealizedPnlUsdc,
      money: sellMoney,
    };
    bet_money = parseNum(merged.betMoney, proceedsBet);
    money = sellMoney;
    return { raw: merged, money, bet_money };
  }

  // 官方订单限价不随成交、卖出或赛果改变；旧同步缺字段时保留已取得的值。
  const savedOrderPrice = parseNum(prevRaw.pmOrderPrice, 0);
  const incomingOrderPrice = parseNum(o.pmOrderPrice, 0);
  const orderPrice = savedOrderPrice > 0 && savedOrderPrice < 1 ? savedOrderPrice : incomingOrderPrice;
  if (orderPrice > 0 && orderPrice < 1)
    merged.pmOrderPrice = orderPrice;
  else
    delete merged.pmOrderPrice;

  // [changmen 扩展] 拒单本金来自原始 POST；旧客户端同步不得重新污染已恢复的金额。
  const isReject = String(o.status ?? o.Status ?? merged.status).toLowerCase() === "reject";
  if (isReject && !(Number(prevRaw.pmShares) > 0) && !(Number(o.pmShares) > 0)) {
    const id = String(o.orderId ?? prevRow?.order_id ?? "");
    const snapshot = validatePmSubmission(prevRaw.pmSubmission, id, Number(prevRaw.pmSubmission?.accountId))
      || validatePmSubmission(o.pmSubmission, id, Number(o.pmSubmission?.accountId));
    if (snapshot) {
      const stake = snapshot.stakeUsdc;
      const cny = stake * getExchange(Currency.USDT);
      return {
        raw: { ...merged, betMoney: cny, pmStakeUsdc: stake,
          pmSubmission: snapshot, pmFeeUsdc: 0, reward: 0, money: 0 },
        bet_money: cny, money: 0,
      };
    }
  }

  const prevState = prevRaw.pmSellState;
  const prevAttr = parseNum(prevRaw.pmAttributedSellShares, 0);
  const incomingAttr = parseNum(o.pmAttributedSellShares ?? merged.pmAttributedSellShares, 0);
  const incomingState = o.pmSellState ?? merged.pmSellState;
  const incomingSellState = String(incomingState ?? "").toLowerCase();
  const hasBetMoneyField = Object.prototype.hasOwnProperty.call(o, "betMoney")
    || Object.prototype.hasOwnProperty.call(o, "BetMoney");
  /**
   * 原始买入本金（bet_money）卖出后不改写。
   * 剩余敞口只靠 pmStakeUsdc / pmAttributedSellShares / pmSellState。
   */
  const originalBet = prevBet > 0 ? prevBet : incomingBet;
  let betMoneyForMerge = originalBet;
  if (!prevBet && hasBetMoneyField && incomingBet > 0)
    betMoneyForMerge = incomingBet;
  // 未卖出：同步可校正含费全成本；显式零费用也能清除旧估算。
  const prevFee = parseNum(prevRaw.pmFeeUsdc, 0);
  const incomingFee = parseNum(o.pmFeeUsdc ?? o.PmFeeUsdc ?? merged.pmFeeUsdc, 0);
  const sellStarted = prevState === "partial"
    || prevState === "closed"
    || (prevAttr > 0 && prevState === "settled");
  if (
    !sellStarted
    && hasBetMoneyField
    && incomingBet > 0
    && (
      (prevFee <= 0 && incomingFee > 0 && incomingBet > prevBet + 1e-9)
      || (Object.prototype.hasOwnProperty.call(o, "pmFeeUsdc")
        && typeof o.pmFeeUsdc === "number" && Number.isFinite(o.pmFeeUsdc) && o.pmFeeUsdc >= 0
        && Math.abs(incomingBet - prevBet) > 1e-6)
    )
  ) {
    betMoneyForMerge = incomingBet;
  }

  const sellStateRank = (s) => {
    const v = String(s ?? "").toLowerCase();
    if (v === "settled")
      return 3;
    if (v === "closed")
      return 2;
    if (v === "partial")
      return 1;
    return 0;
  };

  /**
   * 已手动卖出归因：盈亏累加在买单 money；本金保持原始。
   */
  const hasManualSellProgress = prevState === "partial"
    || prevState === "closed"
    || (prevAttr > 0 && prevState === "settled");
  if (isChangmen && hasManualSellProgress) {
    const advanceAttr = incomingAttr > prevAttr + 1e-9;
    const advanceState = sellStateRank(incomingState) > sellStateRank(prevState);
    let nextState = advanceState || advanceAttr
      ? (incomingState ?? prevRaw.pmSellState)
      : (prevRaw.pmSellState ?? merged.pmSellState);
    if (String(nextState).toLowerCase() === "settled" && (prevState === "closed" || (prevState === "partial" && !polymarketIsEqualSplitOrder(o))))
      nextState = prevState;
    const incomingMoney = parseNum(o.money ?? o.Money, 0);
    const prevMoney = parseNum(prevRaw.money ?? prevRow?.money, 0);
    /**
     * 已手动卖光（closed）：盈亏只来自卖出累加，拒绝 Gamma 赛果 money/status 覆写。
     * 部分卖出仍允许客户端带累计盈亏（含剩余仓结算）的 patch。
     * 赛果 pmMatchResult 与盈亏脱钩：始终允许写入/刷新。
     */
    let nextMoney;
    if (String(prevState).toLowerCase() === "closed") {
      nextMoney = prevMoney;
      nextState = "closed";
    }
    else {
      // 客户端 patch 已含累计盈亏时用 incoming；否则保留 prev
      nextMoney = incomingMoney !== 0 || Object.prototype.hasOwnProperty.call(o, "money")
        || Object.prototype.hasOwnProperty.call(o, "Money")
        ? incomingMoney
        : prevMoney;
      // partial：sync 带 money=0 时勿清掉已累计卖出盈亏（与卖单保留逻辑对称）
      if (Math.abs(incomingMoney) <= 1e-9 && Math.abs(prevMoney) > 1e-9)
        nextMoney = prevMoney;
    }
    const nextMatchResult = normalizePmMatchResult(o.pmMatchResult ?? o.PmMatchResult)
      ?? normalizePmMatchResult(prevRaw.pmMatchResult)
      ?? normalizePmMatchResult(merged.pmMatchResult);
    const prevProceeds = parseNum(prevRaw.pmSellProceeds, NaN);
    const incomingProceeds = parseNum(o.pmSellProceeds ?? merged.pmSellProceeds, NaN);
    /**
     * 只在有真实回款时写入；勿对旧 closed 单 sync 落 0，
     * 否则读路径会优先 0、跳过卖单 BetMoney 兜底。
     */
    let nextProceeds;
    if (String(prevState).toLowerCase() === "closed") {
      if (Number.isFinite(prevProceeds) && prevProceeds > 0)
        nextProceeds = prevProceeds;
      else if (Number.isFinite(incomingProceeds) && incomingProceeds > 0)
        nextProceeds = incomingProceeds;
    }
    else if (Number.isFinite(incomingProceeds) && incomingProceeds > 0) {
      nextProceeds = incomingProceeds;
    }
    else if (Number.isFinite(prevProceeds) && prevProceeds > 0) {
      nextProceeds = prevProceeds;
    }
    const nextLastSellId = String(o.pmLastSellOrderId ?? merged.pmLastSellOrderId ?? "").trim()
      || String(prevRaw.pmLastSellOrderId ?? "").trim()
      || undefined;
    merged = {
      ...merged,
      pmSide: "buy",
      pmOrigin: "changmen",
      pmStakeUsdc: advanceAttr
        ? (merged.pmStakeUsdc ?? o.pmStakeUsdc ?? prevRaw.pmStakeUsdc)
        : (prevRaw.pmStakeUsdc ?? merged.pmStakeUsdc),
      betMoney: betMoneyForMerge,
      pmSellState: nextState,
      pmAttributedSellShares: advanceAttr
        ? incomingAttr
        : (prevRaw.pmAttributedSellShares ?? merged.pmAttributedSellShares),
      money: nextMoney,
      status: "none",
      ...(Number.isFinite(nextProceeds) && nextProceeds > 0
        ? { pmSellProceeds: nextProceeds }
        : {}),
      ...(nextLastSellId ? { pmLastSellOrderId: nextLastSellId } : {}),
      ...(nextMatchResult ? { pmMatchResult: nextMatchResult } : {}),
    };
    // 显式去掉误带的 0，避免污染 raw
    if (!(Number.isFinite(Number(merged.pmSellProceeds)) && Number(merged.pmSellProceeds) > 0))
      delete merged.pmSellProceeds;
    bet_money = betMoneyForMerge;
    money = nextMoney;
  }
  else {
    // 首次写入 partial/closed：允许更新 stake/attr/money；bet_money 仍保留原始
    const allowStakeUpdate = incomingSellState === "partial"
      || incomingSellState === "closed"
      || prevState === "partial"
      || prevState === "closed"
      || (prevState === "settled" && prevAttr > 0)
      || incomingAttr > prevAttr + 1e-9;
    if (allowStakeUpdate) {
      merged.betMoney = betMoneyForMerge;
      bet_money = betMoneyForMerge;
      if (Object.prototype.hasOwnProperty.call(o, "money") || Object.prototype.hasOwnProperty.call(o, "Money")) {
        money = parseNum(o.money ?? o.Money, 0);
        merged.money = money;
      }
    }
    else if (betMoneyForMerge > 0) {
      merged.betMoney = betMoneyForMerge;
      bet_money = betMoneyForMerge;
      // Late POST/trade-only snapshots must not replace an already reconciled
      // all-in cost with nominal principal. Sale-progress updates use the branch above.
      if (Number.isFinite(prevRaw.pmFeeUsdc) && prevRaw.pmFeeUsdc >= 0
        && !(typeof o.pmFeeUsdc === "number" && Number.isFinite(o.pmFeeUsdc) && o.pmFeeUsdc >= 0)) {
        merged.pmStakeUsdc = prevRaw.pmStakeUsdc;
      }
    }
    if (isChangmen) {
      merged.pmOrigin = merged.pmOrigin || "changmen";
      merged.pmSide = "buy";
    }
  }

  if (!isSell) {
    const fillShares = preservePmBuyFillShares(prevRaw, o, merged);
    if (fillShares != null)
      merged.pmShares = fillShares;
    const fillPrice = preservePmFillPrice(prevRaw, o, merged);
    if (fillPrice != null)
      merged.pmFillPrice = fillPrice;
    const feeUsdc = preservePmFeeUsdc(prevRaw, o, merged);
    if (feeUsdc != null)
      merged.pmFeeUsdc = feeUsdc;
    else
      delete merged.pmFeeUsdc;
    // 赛果与盈亏脱钩：任意路径都保留 prev / 入参中的 pmMatchResult，避免 sync 抹掉
    const nextMatchResult = normalizePmMatchResult(o.pmMatchResult ?? o.PmMatchResult)
      ?? normalizePmMatchResult(merged.pmMatchResult)
      ?? normalizePmMatchResult(prevRaw.pmMatchResult);
    if (nextMatchResult)
      merged.pmMatchResult = nextMatchResult;
    // 回款字段保护（对标 pfSellProceeds）：空写入保留库内正数；勿把缺失补成 0
    if (
      !(Number.isFinite(Number(merged.pmSellProceeds)) && Number(merged.pmSellProceeds) > 0)
      && Number.isFinite(Number(prevRaw.pmSellProceeds))
      && Number(prevRaw.pmSellProceeds) > 0
    ) {
      merged.pmSellProceeds = Number(prevRaw.pmSellProceeds);
    }
    if (!(Number.isFinite(Number(merged.pmSellProceeds)) && Number(merged.pmSellProceeds) > 0))
      delete merged.pmSellProceeds;
    if (!String(merged.pmLastSellOrderId ?? "").trim() && String(prevRaw.pmLastSellOrderId ?? "").trim())
      merged.pmLastSellOrderId = prevRaw.pmLastSellOrderId;
  }

  return mergePolymarketSettlementForSave({ prevRow, prevRaw, incoming: o, raw: merged, money, betMoney: bet_money });
}

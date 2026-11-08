/**
 * 用户自签卖出：浏览器已签 MARKET FOK → 中继 POST /v1/orders → 等终态 → 关买单。
 * 不代签、不入 total_balance（链上 USDT 为真源）。
 */

import { roundUsdt } from "./pf_ledger.js";
import { evaluatePfBuyForSell, isPfUserSignedOrder } from "./pf_lifecycle.js";
import {
  loadPfOrdersStrict,
} from "./pf_player_account.js";
import {
  findPfOrderInList,
  rdsBetMoney,
  rdsOrderKey,
  rdsPfApiOrderId,
  rdsPfHash,
} from "./pf_order_row.js";
import {
  decimal18ToWei,
  isPredictFunOrderAccepted,
  weiToDecimal18,
  withHouseOrderLock,
} from "./pf_order_service.js";
import { predictFunPost } from "./pf_api.js";
import { extractSellFill } from "./pf_fill.js";
import {
  settlementFromPredictOfficialStatus,
  waitForPredictOrderTerminal,
} from "./pf_orders.js";
import { pfSellItemLabel, resolvePfOrderLabels } from "./pf_order_labels.js";
import { upsertPfServerOrder } from "./pf_server_order.js";

/**
 * @param {{
 *   playerId: number,
 *   userId: string,
 *   buyOrderId: string,
 *   jwt: string,
 *   createOrderBody?: object,
 *   orderHash?: string,
 *   bookPrice?: number,
 *   bookOdds?: number,
 *   proceedsUsdt?: number,
 * }} params
 */
export async function executePfUserSignedSell(params) {
  const {
    playerId,
    userId,
    buyOrderId,
    jwt,
    createOrderBody,
    orderHash: clientOrderHash,
    bookPrice: clientBookPrice,
    bookOdds: clientBookOdds,
    proceedsUsdt: clientProceeds,
  } = params;

  if (!String(jwt ?? "").trim())
    throw new Error("jwt 必填（用户 Predict Account 鉴权）");

  return withHouseOrderLock(async () => {
    const list = await loadPfOrdersStrict(playerId, userId);
    const buy = findPfOrderInList(list, buyOrderId);
    const gateSell = evaluatePfBuyForSell(buy);
    if (!gateSell.ok)
      throw new Error(gateSell.msg);

    // 历史 house pending_credit：自签路径不碰账本，直接视为已 credited
    if (gateSell.action === "resume_credit") {
      const proceeds = Number(buy.pfSellProceeds) > 0
        ? roundUsdt(buy.pfSellProceeds)
        : 0;
      const stake = rdsBetMoney(buy);
      if (isPfUserSignedOrder(buy) || buy.pfUserSigned) {
        await upsertPfServerOrder(playerId, [{
          orderId: rdsOrderKey(buy),
          provider: "PredictFun",
          match: buy.match ?? buy.Match,
          bet: buy.bet ?? buy.Bet,
          item: buy.item ?? buy.Item,
          odds: Number(buy.Odds ?? buy.odds) || 0,
          betMoney: stake,
          money: roundUsdt(proceeds - stake),
          status: "none",
          createAt: Number(buy.CreateAt ?? buy.createAt) || Date.now(),
          link: buy.Link ?? buy.link,
          pfMarketId: buy.pfMarketId,
          pfTokenId: buy.pfTokenId,
          pfOrderHash: rdsPfHash(buy),
          pfApiOrderId: rdsPfApiOrderId(buy),
          pfHoldShares: buy.pfHoldShares,
          pfSide: "buy",
          pfSellState: "closed",
          pfSellOrderId: buy.pfSellOrderId,
          pfSellProceeds: proceeds,
          pfLedgerState: "credited",
          pfPendingCreditUsdt: 0,
          pfUserSigned: true,
        }], userId);
      }
      return {
        buyOrderId: rdsOrderKey(buy),
        sellOrderId: String(buy.pfSellOrderId ?? "").trim() || rdsOrderKey(buy),
        shares: Number(buy.pfHoldShares) > 0 ? Number(buy.pfHoldShares) : undefined,
        proceedsUsdt: proceeds,
        profit: roundUsdt(proceeds - stake),
        bookPrice: Number(buy.pfBookPrice) || 0,
        bookOdds: Number(buy.Odds ?? buy.odds) || 0,
        playerId,
        resumedCredit: true,
      };
    }

    const resumeClosing = gateSell.action === "resume_closing";
    const marketId = resumeClosing
      ? String(buy.pfMarketId ?? buy.Match ?? buy.match ?? "").trim()
      : gateSell.marketId;
    const tokenId = resumeClosing
      ? String(buy.pfTokenId ?? buy.Item ?? buy.item ?? "").trim()
      : gateSell.tokenId;
    const holdShares = resumeClosing
      ? Number(buy.pfHoldShares)
      : gateSell.holdShares;
    if (!(Number.isFinite(holdShares) && holdShares > 0))
      throw new Error("持仓未就绪，请稍后重试 GetOrder 后再卖");
    if (!marketId || !tokenId)
      throw new Error("买单缺少 marketId/tokenId");

    let sellHash = resumeClosing ? gateSell.sellHash : "";
    let sellApiId = "";
    let bookPrice = Number(clientBookPrice) || Number(buy.pfBookPrice) || 0;
    let bookOdds = Number(clientBookOdds) || Number(buy.Odds ?? buy.odds) || 0;
    let proceedsFallback = Number(clientProceeds) || 0;

    if (!resumeClosing) {
      if (!createOrderBody || typeof createOrderBody !== "object")
        throw new Error("createOrderBody 必填（浏览器已签卖单）");

      const {
        assertSignedOrderMatchesPredictAccount,
        loadPfPlayerPredictAccount,
      } = await import("./pf_account_bind.js");
      const predictAccount = await loadPfPlayerPredictAccount(playerId);
      const bound = assertSignedOrderMatchesPredictAccount(createOrderBody, predictAccount);
      if (!bound.ok)
        throw new Error(bound.msg);

      // 先写 closing + sellHash 再 POST：官网已受理后 RDS 失败会丢卖单指纹，
      // 买单仍 open → 用户/编排可再签卖，双卖风险。
      sellHash = String(
        clientOrderHash
        ?? createOrderBody?.data?.order?.hash
        ?? "",
      ).trim();
      if (!sellHash)
        throw new Error("卖出缺少 order hash，无法确认成交");

      const closingSaved = await upsertPfServerOrder(playerId, [{
        orderId: rdsOrderKey(buy),
        provider: "PredictFun",
        match: buy.match ?? buy.Match,
        bet: buy.bet ?? buy.Bet,
        item: buy.item ?? buy.Item,
        odds: Number(buy.Odds ?? buy.odds) || 0,
        betMoney: rdsBetMoney(buy),
        money: Number(buy.Money ?? buy.money) || 0,
        status: "none",
        createAt: Number(buy.CreateAt ?? buy.createAt) || Date.now(),
        link: buy.Link ?? buy.link,
        pfMarketId: marketId,
        pfTokenId: tokenId,
        pfOrderHash: rdsPfHash(buy),
        pfApiOrderId: rdsPfApiOrderId(buy),
        pfSharesWei: buy.pfSharesWei ? String(buy.pfSharesWei) : undefined,
        pfShares: Number(buy.pfShares) > 0 ? Number(buy.pfShares) : undefined,
        pfHoldShares: holdShares,
        pfBookPrice: buy.pfBookPrice,
        pfSide: "buy",
        pfSellState: "closing",
        pfSellOrderId: sellHash,
        pfNotionalUsdt: buy.pfNotionalUsdt,
        pfUserSigned: true,
      }], userId);
      if (!closingSaved)
        throw new Error("卖出状态落库失败（closing），未向官网提交");

      const result = await predictFunPost("/v1/orders", createOrderBody, jwt);
      if (!isPredictFunOrderAccepted(result)) {
        const code = String(result?.data?.code ?? "").trim();
        // 未受理：回滚 closing → open，允许重新签卖
        try {
          await upsertPfServerOrder(playerId, [{
            orderId: rdsOrderKey(buy),
            provider: "PredictFun",
            match: buy.match ?? buy.Match,
            bet: buy.bet ?? buy.Bet,
            item: buy.item ?? buy.Item,
            odds: Number(buy.Odds ?? buy.odds) || 0,
            betMoney: rdsBetMoney(buy),
            money: Number(buy.Money ?? buy.money) || 0,
            status: "none",
            createAt: Number(buy.CreateAt ?? buy.createAt) || Date.now(),
            link: buy.Link ?? buy.link,
            pfMarketId: marketId,
            pfTokenId: tokenId,
            pfOrderHash: rdsPfHash(buy),
            pfApiOrderId: rdsPfApiOrderId(buy),
            pfSharesWei: buy.pfSharesWei ? String(buy.pfSharesWei) : undefined,
            pfShares: Number(buy.pfShares) > 0 ? Number(buy.pfShares) : undefined,
            pfHoldShares: holdShares,
            pfBookPrice: buy.pfBookPrice,
            pfSide: "buy",
            pfSellState: "open",
            pfNotionalUsdt: buy.pfNotionalUsdt,
            pfUserSigned: true,
            pfSellOrderId: "",
            pfClearSellOrderId: true,
          }], userId);
        }
        catch (rollbackErr) {
          console.warn("[Pf_Sell] reject rollback failed", sellHash, rollbackErr);
        }
        throw new Error(code
          ? `Predict.fun 卖出未受理（code: ${code}）`
          : "Predict.fun 卖出未受理");
      }

      sellApiId = String(result?.data?.orderId ?? "").trim();
    }

    const officialFilled = await waitForPredictOrderTerminal(sellHash, jwt);
    const settlement = settlementFromPredictOfficialStatus(officialFilled?.status);
    if (settlement !== "filled") {
      const st = String(officialFilled?.status ?? "timeout").toUpperCase();
      // 官网 FOK 未成交（CANCELLED/EXPIRED/…）或超时：回滚 closing → open，允许重新签卖
      // @see https://dev.predict.fun/orderdata-14037505d0 OrderStatus
      try {
        await upsertPfServerOrder(playerId, [{
          orderId: rdsOrderKey(buy),
          provider: "PredictFun",
          match: buy.match ?? buy.Match,
          bet: buy.bet ?? buy.Bet,
          item: buy.item ?? buy.Item,
          odds: Number(buy.Odds ?? buy.odds) || 0,
          betMoney: rdsBetMoney(buy),
          money: Number(buy.Money ?? buy.money) || 0,
          status: "none",
          createAt: Number(buy.CreateAt ?? buy.createAt) || Date.now(),
          link: buy.Link ?? buy.link,
          pfMarketId: marketId,
          pfTokenId: tokenId,
          pfOrderHash: rdsPfHash(buy),
          pfApiOrderId: rdsPfApiOrderId(buy),
          pfSharesWei: buy.pfSharesWei ? String(buy.pfSharesWei) : undefined,
          pfShares: Number(buy.pfShares) > 0 ? Number(buy.pfShares) : undefined,
          pfHoldShares: holdShares,
          pfBookPrice: buy.pfBookPrice,
          pfSide: "buy",
          pfSellState: "open",
          pfNotionalUsdt: buy.pfNotionalUsdt,
          pfUserSigned: true,
          pfSellOrderId: "",
          pfClearSellOrderId: true,
        }], userId);
      }
      catch (rollbackErr) {
        console.warn("[Pf_Sell] closing rollback failed", sellHash, rollbackErr);
      }
      throw new Error(
        settlement === "unfilled"
          ? `Predict.fun 卖出未成交（${st}），可重新卖出`
          : `Predict.fun 卖出确认超时（status=${st}），可重新卖出`,
      );
    }

    let sharesWei = 0n;
    try {
      sharesWei = decimal18ToWei(holdShares);
    }
    catch {
      sharesWei = 0n;
    }

    const fill = extractSellFill(officialFilled, {
      fallbackProceedsUsdt: proceedsFallback,
      fallbackSharesWei: sharesWei,
    });
    const filledSharesWei = fill.sharesWei;
    if (filledSharesWei <= 0n)
      throw new Error("卖出未获得官网成交份额，请稍后重试");

    const proceeds = roundUsdt(fill.proceedsUsdt);
    const stake = rdsBetMoney(buy);
    const profit = roundUsdt(proceeds - stake);
    const createAt = Date.now();
    const buyLabels = resolvePfOrderLabels({
      marketId,
      tokenId,
      match: buy.match ?? buy.Match,
      bet: buy.bet ?? buy.Bet,
      item: buy.item ?? buy.Item,
    });
    const sellItem = pfSellItemLabel(buyLabels.item);
    const sellOrderId = sellHash || sellApiId;

    if (!(bookPrice > 0))
      bookPrice = Number(buy.pfBookPrice) || 0;
    if (!(bookOdds > 0) && bookPrice > 0)
      bookOdds = 0;

    const closedSaved = await upsertPfServerOrder(playerId, [
      {
        orderId: rdsOrderKey(buy),
        provider: "PredictFun",
        match: buyLabels.match,
        bet: buyLabels.bet,
        item: buyLabels.item,
        odds: Number(buy.Odds ?? buy.odds) || 0,
        betMoney: stake,
        money: profit,
        status: "none",
        createAt: Number(buy.CreateAt ?? buy.createAt) || createAt,
        link: buy.Link ?? buy.link,
        pfMarketId: marketId,
        pfTokenId: tokenId,
        pfOrderHash: rdsPfHash(buy),
        pfApiOrderId: rdsPfApiOrderId(buy),
        pfSharesWei: buy.pfSharesWei ? String(buy.pfSharesWei) : undefined,
        pfShares: Number(buy.pfShares) > 0 ? Number(buy.pfShares) : undefined,
        pfHoldShares: holdShares,
        pfBookPrice: buy.pfBookPrice,
        pfSide: "buy",
        pfSellState: "closed",
        pfSellOrderId: sellOrderId,
        pfSellProceeds: proceeds,
        pfAmountFilled: fill.amountFilledRaw,
        pfFeeRateBps: buy.pfFeeRateBps,
        pfLedgerState: "credited",
        pfPendingCreditUsdt: 0,
        pfUserSigned: true,
        positionEvents: {
          sells: [{
            id: sellOrderId,
            at: createAt,
            shares: weiToDecimal18(filledSharesWei),
            price: bookPrice > 0 ? bookPrice : undefined,
            proceeds,
            pnl: profit,
            origin: "changmen",
            status: "closed",
          }],
        },
      },
      {
        orderId: sellOrderId,
        provider: "PredictFun",
        match: buyLabels.match,
        bet: buyLabels.bet,
        item: sellItem,
        odds: bookOdds,
        betMoney: proceeds,
        money: 0,
        status: "none",
        createAt,
        link: buy.Link ?? buy.link,
        pfMarketId: marketId,
        pfTokenId: tokenId,
        pfOrderHash: sellHash,
        pfApiOrderId: sellApiId,
        pfSharesWei: String(filledSharesWei),
        pfShares: weiToDecimal18(filledSharesWei),
        pfBookPrice: bookPrice,
        pfFeeRateBps: Number(buy.pfFeeRateBps) >= 0 ? Number(buy.pfFeeRateBps) : undefined,
        pfSide: "sell",
        pfBuyOrderId: rdsOrderKey(buy),
        pfSellState: "closed",
        pfOfficialStatus: officialFilled?.status,
        pfAmountFilled: fill.amountFilledRaw,
        pfUserSigned: true,
      },
    ], userId);
    if (!closedSaved)
      throw new Error("卖出落库失败");

    return {
      buyOrderId: rdsOrderKey(buy),
      sellOrderId,
      shares: weiToDecimal18(filledSharesWei),
      proceedsUsdt: proceeds,
      profit,
      bookPrice,
      bookOdds,
      playerId,
    };
  });
}

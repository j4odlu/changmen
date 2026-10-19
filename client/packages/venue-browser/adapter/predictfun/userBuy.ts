/**
 * 用户自有账号：浏览器预检 + 签 MARKET FOK（不经 house 代签）。
 * @see https://dev.predict.fun/how-to-create-or-cancel-orders-679306m0
 */

import { truncateOddsTo3 } from "@changmen/shared/odds_format";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";

import { fetchPredictMarket, fetchPredictOrderbook } from "./api";
import { isValidPredictClobPrice } from "./pfDetection";
import {
  assertPredictFokBuyDepth,
  assertPredictMarketTradable,
  bestAskFromPredictBook,
  bestBidFromPredictBook,
  executableBuyBook,
  executableSellBook,
  filterAsksByMaxPrice,
  filterBidsByMinPrice,
} from "./pfBuyBook";
import { preparePredictFunUserSession } from "./userSession";

/** 默认 2%：MARKET + isMinAmountOut */
export const DEFAULT_PF_USER_SLIPPAGE_BPS = 200n;

export interface PfUserCheckBuyResult {
  tokenId: string;
  marketId: string;
  apiBetMoney: number;
  detectionOdds: number;
  detectionMaxPrice: number;
  bookPrice: number;
  bookOdds: number;
  bookFetchedAt: number;
  feeRateBps: number;
  isNegRisk: boolean;
  isYieldBearing: boolean;
  side: "BUY";
  playerId: number;
}

export interface PfSignedOrderSubmitPayload {
  /** 官网 POST /v1/orders 的 body */
  createOrderBody: {
    data: {
      order: Record<string, unknown>;
      pricePerShare: string;
      strategy: "MARKET";
      slippageBps: string;
      isFillOrKill: true;
      isMinAmountOut: boolean;
    };
  };
  jwt: string;
  bookPrice: number;
  bookOdds: number;
  makerUsdt: number;
  sharesWei: string;
  feeRateBps: number;
  orderHash: string;
}

function parseUsdtToWei(amount: number): bigint {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`无效买入金额 ${amount}`);
  return BigInt(Math.round(value * 1e6)) * 1_000_000_000_000n;
}

function weiToDecimal18(wei: bigint): number {
  try {
    return Number(wei) / 1e18;
  }
  catch {
    return 0;
  }
}

/** 浏览器预检：拉 orderbook + market，校验限价与 FOK 深度 */
export async function checkPredictFunUserBuy(params: {
  account: PlatformAccount;
  marketId: string;
  tokenId: string;
  apiBetMoney: number;
  detectionMaxPrice: number;
  detectionOdds: number;
}): Promise<PfUserCheckBuyResult> {
  const { account, marketId, tokenId, apiBetMoney, detectionMaxPrice, detectionOdds } = params;
  if (!account?.accountId)
    throw new Error("PredictFun 账号缺少 playerId");
  if (!marketId)
    throw new Error("缺少 Predict.fun marketId");
  if (!isValidPredictClobPrice(detectionMaxPrice))
    throw new Error(`无效检测价 ${detectionMaxPrice}`);

  const [yesBook, market] = await Promise.all([
    fetchPredictOrderbook(marketId),
    fetchPredictMarket(marketId),
  ]);
  // fetchPredictOrderbook 失败会抛错；此处仅兜底空对象
  if (!yesBook)
    throw new Error(`Predict.fun orderbook 为空（market ${marketId}）`);
  assertPredictMarketTradable(market);

  const sideBook = executableBuyBook(yesBook, market, tokenId);
  const asks = filterAsksByMaxPrice(sideBook.asks as Array<[number, number]> | undefined, detectionMaxPrice);
  if (!asks.length) {
    const best = bestAskFromPredictBook(sideBook);
    const liveOdds = best > 0 ? truncateOddsTo3(1 / best) : 0;
    throw new Error([
      "Predict.fun 盘口价高于检测价，整单取消",
      best > 0
        ? `- 现价 ${best}（赔率 ${liveOdds}）高于检测上限 ${detectionMaxPrice}`
        : "- 盘口无卖单",
    ].join("\n"));
  }

  assertPredictFokBuyDepth(asks, apiBetMoney);
  const bookPrice = bestAskFromPredictBook({ asks });
  if (!isValidPredictClobPrice(bookPrice))
    throw new Error("Predict.fun 盘口无有效 best ask");

  return {
    tokenId,
    marketId,
    apiBetMoney,
    detectionOdds,
    detectionMaxPrice,
    bookPrice,
    bookOdds: truncateOddsTo3(1 / bookPrice),
    bookFetchedAt: Date.now(),
    feeRateBps: Number(market?.feeRateBps ?? 0) || 0,
    isNegRisk: Boolean(market?.isNegRisk),
    isYieldBearing: Boolean(market?.isYieldBearing),
    side: "BUY",
    playerId: Number(account.accountId),
  };
}

/**
 * 浏览器：OrderBuilder 签 MARKET FOK BUY，返回可中继的官网 body + 用户 JWT。
 * 首次下单前 best-effort setApprovals（Privy 上需有 BNB gas）。
 */
export async function signPredictFunUserMarketBuy(params: {
  account: PlatformAccount;
  marketId: string;
  tokenId: string;
  apiBetMoney: number;
  maxPrice: number;
  feeRateBps: number;
  isNegRisk: boolean;
  isYieldBearing: boolean;
  maxSlippageBps?: bigint;
}): Promise<PfSignedOrderSubmitPayload> {
  const session = await preparePredictFunUserSession(params.account);
  const jwt = await session.getJwt();

  const [{ Side }, yesBook, market] = await Promise.all([
    import("@predictdotfun/sdk").then(m => ({ Side: m.Side })),
    fetchPredictOrderbook(params.marketId),
    fetchPredictMarket(params.marketId),
  ]);
  if (!yesBook)
    throw new Error("下单前 orderbook 为空");
  assertPredictMarketTradable(market);

  // approvals：失败时给出明确错误（需 Privy EOA 有 BNB）
  if (typeof session.orderBuilder.setApprovals === "function") {
    try {
      const appr = await session.orderBuilder.setApprovals();
      if (appr && appr.success === false)
        throw new Error("Predict.fun approvals 未成功（请确认 Privy 地址有少量 BNB 作 gas）");
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/BNB|gas|approvals/i.test(msg))
        throw err;
      throw new Error(`Predict.fun approvals 失败：${msg}（Privy 地址需有 BNB）`);
    }
  }

  const sideBook = executableBuyBook(yesBook, market, params.tokenId);
  const cappedAsks = filterAsksByMaxPrice(
    sideBook.asks as Array<[number, number]> | undefined,
    params.maxPrice,
  );
  if (!cappedAsks.length)
    throw new Error("下单前盘口价高于检测价或无 asks");

  const book = {
    marketId: Number(params.marketId),
    updateTimestampMs: Number(sideBook.updateTimestampMs ?? yesBook.updateTimestampMs ?? Date.now()),
    asks: cappedAsks,
    bids: (sideBook.bids ?? []) as Array<[number, number]>,
  };

  const slippageBps = params.maxSlippageBps ?? DEFAULT_PF_USER_SLIPPAGE_BPS;
  const orderBuilder = session.orderBuilder;

  const amounts = orderBuilder.getMarketOrderAmounts(
    {
      side: Side.BUY,
      valueWei: parseUsdtToWei(params.apiBetMoney),
      slippageBps,
      isMinAmountOut: true,
    },
    book,
  );

  const maker = session.maker;
  const feeRateBps = Number(params.feeRateBps ?? market?.feeRateBps ?? 0) || 0;
  const order = orderBuilder.buildOrder("MARKET", {
    maker,
    signer: maker,
    side: Side.BUY,
    tokenId: params.tokenId,
    makerAmount: amounts.makerAmount,
    takerAmount: amounts.takerAmount,
    nonce: 0n,
    feeRateBps,
  });

  const typedData = orderBuilder.buildTypedData(order, {
    isNegRisk: Boolean(params.isNegRisk ?? market?.isNegRisk),
    isYieldBearing: Boolean(params.isYieldBearing ?? market?.isYieldBearing),
  });
  const signedOrder = await orderBuilder.signTypedDataOrder(typedData);
  const hash = orderBuilder.buildTypedDataHash(typedData);
  const bookPrice = bestAskFromPredictBook({ asks: cappedAsks });

  return {
    createOrderBody: {
      data: {
        order: { ...signedOrder, hash },
        pricePerShare: amounts.pricePerShare.toString(),
        strategy: "MARKET",
        slippageBps: slippageBps.toString(),
        isFillOrKill: true,
        isMinAmountOut: Boolean(amounts.isMinAmountOut),
      },
    },
    jwt,
    bookPrice,
    bookOdds: truncateOddsTo3(1 / bookPrice),
    makerUsdt: weiToDecimal18(amounts.makerAmount),
    sharesWei: String(amounts.takerAmount),
    feeRateBps,
    orderHash: String(hash),
  };
}

function decimal18ToWei(amount: number): bigint {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`无效份额 ${amount}`);
  return BigInt(Math.round(value * 1e18));
}

export interface PfSignedSellSubmitPayload extends PfSignedOrderSubmitPayload {
  proceedsUsdt: number;
  shares: number;
}

/**
 * 浏览器：OrderBuilder 签 MARKET FOK SELL（1:1 全卖 holdShares）。
 */
export async function signPredictFunUserMarketSell(params: {
  account: PlatformAccount;
  marketId: string;
  tokenId: string;
  holdShares: number;
  feeRateBps?: number;
  isNegRisk?: boolean;
  isYieldBearing?: boolean;
  minPrice?: number;
  maxSlippageBps?: bigint;
}): Promise<PfSignedSellSubmitPayload> {
  const sharesWei = decimal18ToWei(params.holdShares);
  const session = await preparePredictFunUserSession(params.account);
  const jwt = await session.getJwt();

  const [{ Side }, yesBook, market] = await Promise.all([
    import("@predictdotfun/sdk").then(m => ({ Side: m.Side })),
    fetchPredictOrderbook(params.marketId),
    fetchPredictMarket(params.marketId),
  ]);
  if (!yesBook)
    throw new Error("卖出前 orderbook 为空");
  assertPredictMarketTradable(market);

  const sideBook = executableSellBook(yesBook, market, params.tokenId);
  const cappedBids = filterBidsByMinPrice(
    sideBook.bids as Array<[number, number]> | undefined,
    params.minPrice,
  );
  if (!cappedBids.length) {
    const best = bestBidFromPredictBook(sideBook);
    throw new Error(
      best > 0
        ? `Predict.fun 买盘低于底价（best bid ${best}）`
        : "Predict.fun 盘口无 bids，无法市价卖出",
    );
  }

  const book = {
    marketId: Number(params.marketId),
    updateTimestampMs: Number(sideBook.updateTimestampMs ?? yesBook.updateTimestampMs ?? Date.now()),
    asks: (sideBook.asks ?? []) as Array<[number, number]>,
    bids: cappedBids,
  };

  const slippageBps = params.maxSlippageBps ?? DEFAULT_PF_USER_SLIPPAGE_BPS;
  const orderBuilder = session.orderBuilder;

  const amounts = orderBuilder.getMarketOrderAmounts(
    {
      side: Side.SELL,
      quantityWei: sharesWei,
      slippageBps,
    },
    book,
  );

  const maker = session.maker;
  const feeRateBps = Number(params.feeRateBps ?? market?.feeRateBps ?? 0) || 0;
  const order = orderBuilder.buildOrder("MARKET", {
    maker,
    signer: maker,
    side: Side.SELL,
    tokenId: params.tokenId,
    makerAmount: amounts.makerAmount,
    takerAmount: amounts.takerAmount,
    nonce: 0n,
    feeRateBps,
  });

  const typedData = orderBuilder.buildTypedData(order, {
    isNegRisk: Boolean(params.isNegRisk ?? market?.isNegRisk),
    isYieldBearing: Boolean(params.isYieldBearing ?? market?.isYieldBearing),
  });
  const signedOrder = await orderBuilder.signTypedDataOrder(typedData);
  const hash = orderBuilder.buildTypedDataHash(typedData);
  const bookPrice = bestBidFromPredictBook({ bids: cappedBids });
  const proceedsUsdt = weiToDecimal18(amounts.takerAmount);

  return {
    createOrderBody: {
      data: {
        order: { ...signedOrder, hash },
        pricePerShare: amounts.pricePerShare.toString(),
        strategy: "MARKET",
        slippageBps: slippageBps.toString(),
        isFillOrKill: true,
        isMinAmountOut: Boolean(amounts.isMinAmountOut),
      },
    },
    jwt,
    bookPrice,
    bookOdds: bookPrice > 0 ? truncateOddsTo3(1 / bookPrice) : 0,
    makerUsdt: weiToDecimal18(amounts.makerAmount),
    sharesWei: String(sharesWei),
    feeRateBps,
    orderHash: String(hash),
    proceedsUsdt,
    shares: weiToDecimal18(sharesWei),
  };
}

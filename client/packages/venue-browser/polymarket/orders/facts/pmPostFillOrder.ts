import type { BetOption } from "@changmen/client-core/models/betOption";
import type { BetResult } from "@changmen/client-core/models/betResult";
import type { VenueOrder } from "@changmen/client-core/contract";
import { PLATFORMS } from "@changmen/client-core/shared/platforms";
import { isPolymarketBetResultFillConfirmed } from "./orderStatus";
import { parsePolymarketBuyOrderFill, scalePolymarketVenueOrdersForDisplay } from "../history/orders";
import type { PolymarketOrderResponseLike } from "./orderTypes";
import { lookupPolymarketOrderBetLabel } from "../../markets/orderBetLabel";
import {
  computePolymarketBuyAllInStakeUsdc,
  fetchPolymarketMarketFeeDetails,
} from "../pmFee";

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export interface PolymarketMatchedBuyDisplayCtx {
  odds?: number;
  createAt?: number;
  game?: string;
  match?: string;
  bet?: string;
  item?: string;
  pmTokenId?: string;
  pmConditionId?: string;
  /** POST 缺 makingAmount 时用预检 USDC / bookPrice 兜底 */
  fallbackStakeUsdc?: number;
  fallbackPrice?: number;
  /** 已算好的手续费 USDC；优先于 feeRate */
  feeUsdc?: number;
  /** 平台 feeRate（无 feeUsdc 时现场算） */
  feeRate?: number;
  feeExponent?: number;
  feeTakerOnly?: boolean;
  isTaker?: boolean;
  builderTakerBps?: number;
}

/**
 * 官方 Place Order：FOK BUY `matched` + takingAmount 即为成交真相，
 * 不必等 `/data/trades` 索引。返回 CLOB 口径 USDC（save 前再 scale 一次）。
 * makingAmount 缺失时用 fallbackStakeUsdc + takingAmount/price 补齐。
 *
 * 买入价 pmFillPrice = 官网/CLOB 撮合均价（activity.price / making÷taking，不含费）；
 * betMoney / pmStakeUsdc = 官网 usdcSize 或 名义+fee（含费全成本）。
 */
export function buildPolymarketMatchedBuyVenueOrderUsdc(
  orderId: string,
  response: PolymarketOrderResponseLike | null | undefined,
  ctx: PolymarketMatchedBuyDisplayCtx = {},
): VenueOrder | null {
  const id = String(orderId ?? "").trim();
  if (!id)
    return null;
  const fill = parsePolymarketBuyOrderFill(response);
  let stake = fill.stakeUsdc;
  let shares = fill.shares;
  const fallbackStake = Number(ctx.fallbackStakeUsdc);
  const fallbackPrice = Number(ctx.fallbackPrice);
  const oddsHint = Number(ctx.odds);
  const priceHint = (fallbackPrice > 0 && fallbackPrice < 1)
    ? fallbackPrice
    : (oddsHint > 1 ? (1 / oddsHint) : 0);

  if (!(stake > 0) && fallbackStake > 0)
    stake = round4(fallbackStake);
  if (!(shares > 0) && stake > 0 && priceHint > 0)
    shares = round4(stake / priceHint);
  if (!(stake > 0) && shares > 0 && priceHint > 0)
    stake = round4(shares * priceHint);

  if (!(stake > 0) || !(shares > 0))
    return null;
  const matchPrice = stake / shares;
  if (!(matchPrice > 0 && matchPrice < 1))
    return null;

  const allIn = computePolymarketBuyAllInStakeUsdc({
    grossStakeUsdc: stake,
    shares,
    feeUsdc: ctx.feeUsdc,
    feeRate: ctx.feeRate,
    exponent: ctx.feeExponent,
    takerOnly: ctx.feeTakerOnly,
    isTaker: ctx.isTaker !== false,
    builderTakerBps: ctx.builderTakerBps,
  });

  const oddsFromMatch = round4(1 / matchPrice);
  const odds = oddsHint > 0 ? oddsHint : oddsFromMatch;
  const stakeAllIn = allIn.allInStakeUsdc;
  // 可得/兑付按名义成本×赔率（≈份额×$1），勿用含费全成本抬高 reward
  const reward = round4(stake * odds);
  return {
    provider: PLATFORMS.Polymarket,
    orderId: id,
    odds,
    createAt: Number(ctx.createAt) > 0 ? Number(ctx.createAt) : Date.now(),
    betMoney: stakeAllIn,
    reward,
    money: 0,
    status: "none",
    game: String(ctx.game ?? ""),
    match: String(ctx.match ?? ""),
    bet: String(ctx.bet ?? ""),
    item: String(ctx.item ?? ""),
    pmTokenId: String(ctx.pmTokenId ?? "").trim() || undefined,
    pmShares: shares,
    pmFillPrice: round4(matchPrice),
    pmStakeUsdc: stakeAllIn,
    pmFeeUsdc: allIn.feeUsdc > 0 ? allIn.feeUsdc : undefined,
    pmConditionId: String(ctx.pmConditionId ?? "").trim() || undefined,
    pmSide: "buy",
    pmSellState: "open",
    pmOrigin: "changmen",
  };
}

/** 侧栏/RDS 展示口径（CNY），与 getOrders → scale 一致 */
export function buildPolymarketMatchedBuyVenueOrderForSave(
  orderId: string,
  response: PolymarketOrderResponseLike | null | undefined,
  ctx: PolymarketMatchedBuyDisplayCtx = {},
): VenueOrder | null {
  const usdc = buildPolymarketMatchedBuyVenueOrderUsdc(orderId, response, ctx);
  if (!usdc)
    return null;
  return scalePolymarketVenueOrdersForDisplay([usdc])[0] ?? null;
}

/** 查市场费率后合成 matched 买单（CNY） */
export async function buildPolymarketMatchedBuyVenueOrderForSaveAsync(
  orderId: string,
  response: PolymarketOrderResponseLike | null | undefined,
  ctx: PolymarketMatchedBuyDisplayCtx = {},
): Promise<VenueOrder | null> {
  const conditionId = String(ctx.pmConditionId ?? "").trim();
  let next = { ...ctx };
  if (
    conditionId
    && !(Number(ctx.feeUsdc) >= 0 && Number.isFinite(Number(ctx.feeUsdc)))
    && !(Number(ctx.feeRate) > 0)
  ) {
    const fd = await fetchPolymarketMarketFeeDetails(conditionId);
    next = {
      ...next,
      feeRate: fd.feeRate,
      feeExponent: fd.exponent,
      feeTakerOnly: fd.takerOnly,
      isTaker: ctx.isTaker !== false,
    };
  }
  return buildPolymarketMatchedBuyVenueOrderForSave(orderId, response, next);
}

/**
 * 从 BetOption + BetResult 拼 matched 买单。
 * delayed / 未成交返回 null（仍走 settlement / trades）。
 */
export async function buildPolymarketMatchedBuyVenueOrderFromBet(
  option: BetOption,
  result: BetResult,
): Promise<VenueOrder | null> {
  if (!isPolymarketBetResultFillConfirmed(result))
    return null;
  const orderId = String(result.orderId ?? "").trim();
  const named = option.target === "Home"
    ? option.bet?.homeName
    : option.bet?.awayName;
  const matchTitle = String(option.match?.title ?? "");
  const target = String(option.target ?? "").trim();
  const fromMatch = (() => {
    const parts = matchTitle.split(/\s*[-–—]?\s*vs\.?\s*[-–—]?\s*|\s+v\.?\s+/i);
    if (parts.length !== 2)
      return "";
    const clean = (s: string) => String(s ?? "")
      .replace(/^[-–—\s]+|[-–—\s]+$/g, "")
      .trim();
    const side = target === "Away" ? parts[1] : parts[0];
    return clean(side);
  })();
  const itemName = String(named ?? "").trim() || fromMatch || target;
  const data = (option.data ?? {}) as {
    bookPrice?: number;
    apiBetMoney?: number;
    betMoney?: number;
  };
  const bookPrice = Number(data.bookPrice);
  const fallbackStake = Number(data.apiBetMoney) > 0
    ? Number(data.apiBetMoney)
    : Number(option.betMoney);
  return buildPolymarketMatchedBuyVenueOrderForSaveAsync(
    orderId,
    result.response as PolymarketOrderResponseLike | undefined,
    {
      odds: Number(option.newOdds) > 0 ? Number(option.newOdds) : Number(option.odds) || 0,
      createAt: Number(result.beginTime) > 0 ? Number(result.beginTime) : Date.now(),
      game: option.match?.game ?? "",
      match: option.match?.title ?? "",
      bet: lookupPolymarketOrderBetLabel(option.betId, option.itemId) || "盘口待核实",
      item: String(itemName ?? "").trim(),
      pmTokenId: String(option.itemId ?? "").trim(),
      pmConditionId: String(option.betId ?? "").trim(),
      fallbackStakeUsdc: fallbackStake > 0 ? fallbackStake : undefined,
      fallbackPrice: bookPrice > 0 && bookPrice < 1 ? bookPrice : undefined,
    },
  );
}

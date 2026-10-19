import type { PlatformProvider, ResolveLegOutcomeOpts, VenueOrder } from "../contract";
import type { AccountBalanceResult } from "../contract";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { getCollectPlatform } from "@changmen/client-core/bridge/clientApi";
import { getVenueOddsEntry } from "@changmen/client-core/bridge/oddsAccess";
import { PLATFORMS } from "../shared/platforms";

import {
  pfGetOrders,
  pfSubmitSignedOrder,
} from "./pfClientApi";
import {
  detectionMaxPriceFromOdds,
  isValidPredictClobPrice,
  resolvePredictFunDetectionMaxPrice,
  resolvePredictFunDetectionMaxPriceRaw,
} from "./pfDetection";
import { resolvePredictFunProviderLegOutcome } from "./legOutcome";
import {
  isPredictFunMarketIndex,
  lookupPredictFunMarketIdByToken,
  rememberPredictFunTokenMarketIds,
} from "./marketIndex";
import {
  preparePredictFunUserSession,
  predictFunUsdtFromWei,
} from "./userSession";
import {
  parsePredictFunTokenConfig,
  resolvePredictFunPredictAccount,
} from "./credentials";
import {
  checkPredictFunUserBuy,
  signPredictFunUserMarketBuy,
} from "./userBuy";

const PLATFORM = PLATFORMS.PredictFun;
/** check 结果复用窗：缩短以压受理前盘口漂移 */
const PRECHECK_BOOK_REUSE_MS = 400;

export interface PredictFunBuyCheckData {
  tokenId: string;
  marketId: string;
  odds: number;
  detectionOdds: number;
  detectionMaxPrice: number;
  detectionClobPrice?: number;
  bookPrice: number;
  betMoney: number;
  apiBetMoney: number;
  side: "BUY";
  bookFetchedAt: number;
  feeRateBps: number;
  isNegRisk: boolean;
  isYieldBearing: boolean;
  playerId?: number;
}

function resolveApiBetMoney(option: BetOption): number {
  const value = Number(option.betMoney);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`无效买入金额 ${option.betMoney}`);
  return Math.round(value * 100) / 100;
}

/** 侧栏 Match/Bet/Item：与 PM 一样用队名/盘口，不用裸 ID */
export function buildPfOrderDisplayLabels(option: BetOption): {
  match: string;
  bet: string;
  item: string;
} {
  const bet = option.bet;
  const match = option.match;
  const home = String(bet?.homeName ?? "").trim();
  const away = String(bet?.awayName ?? "").trim();
  const title = String(match?.title ?? "").trim();
  const matchLabel = title || (home && away ? `${home} vs ${away}` : "");
  const betLabel = bet?.getBetName?.() || "全场胜负";
  const itemLabel = option.target === "Away"
    ? (away || "客队")
    : (home || "主队");
  return {
    match: matchLabel,
    bet: betLabel,
    item: itemLabel,
  };
}

function resolveDetectionOdds(option: BetOption): number {
  const data = option.data as { detectionOdds?: number } | null | undefined;
  const fromData = Number(data?.detectionOdds);
  if (Number.isFinite(fromData) && fromData > 1)
    return fromData;
  return option.odds;
}

function resolveMarketIdSync(option: BetOption, tokenId: string): string {
  const fromData = option.data as { marketId?: string } | null | undefined;
  const fromItem = option.item
    ? String(
      option.target === "Home"
        ? (option.item.homeSubscribeId || "")
        : (option.item.awaySubscribeId || ""),
    ).trim()
    : "";
  const cached = getVenueOddsEntry(PLATFORM, tokenId)?.marketId;
  const fromIndex = lookupPredictFunMarketIdByToken(tokenId);
  return String(fromData?.marketId ?? fromItem ?? cached ?? fromIndex ?? "").trim();
}

async function ensureMarketId(option: BetOption, tokenId: string): Promise<string> {
  const hit = resolveMarketIdSync(option, tokenId);
  if (hit)
    return hit;
  try {
    const platform = await getCollectPlatform(PLATFORM);
    const index = isPredictFunMarketIndex(platform?.MarketIndex) ? platform.MarketIndex : null;
    if (index)
      rememberPredictFunTokenMarketIds(index);
  }
  catch {
    /* ignore — 下面仍报缺 marketId */
  }
  return resolveMarketIdSync(option, tokenId);
}

function isPredictFunBuyCheckData(data: unknown): data is PredictFunBuyCheckData {
  if (!data || typeof data !== "object")
    return false;
  const row = data as PredictFunBuyCheckData;
  return row.side === "BUY"
    && Boolean(row.tokenId)
    && Boolean(row.marketId)
    && Number.isFinite(row.bookPrice) && row.bookPrice > 0
    && Number.isFinite(row.bookFetchedAt) && row.bookFetchedAt > 0;
}

function applyCheckResult(
  option: BetOption,
  checked: {
    tokenId: string;
    marketId: string;
    bookOdds: number;
    bookPrice: number;
    bookFetchedAt: number;
    feeRateBps: number;
    isNegRisk: boolean;
    isYieldBearing: boolean;
    playerId?: number;
  },
  detectionOdds: number,
  apiBetMoney: number,
  execMaxPrice: number,
  rawMaxPrice: number,
): void {
  option.odds = checked.bookOdds;
  option.newOdds = checked.bookOdds;
  option.data = {
    tokenId: checked.tokenId,
    marketId: checked.marketId,
    odds: checked.bookOdds,
    detectionOdds,
    // 执行限价（可配倍数或裸价）：submit 必须原样复用，禁止再 resolve 改限价
    detectionMaxPrice: execMaxPrice,
    // 检测锁价（attach / raw）：供 fo 同档判断；勿与其它字段混用
    detectionClobPrice: rawMaxPrice,
    bookPrice: checked.bookPrice,
    betMoney: option.betMoney,
    apiBetMoney,
    side: "BUY",
    bookFetchedAt: checked.bookFetchedAt,
    feeRateBps: checked.feeRateBps,
    isNegRisk: checked.isNegRisk,
    isYieldBearing: checked.isYieldBearing,
    playerId: checked.playerId,
  } satisfies PredictFunBuyCheckData;
}

export function isPredictFunOrderAccepted(
  result: { orderId?: string } | null | undefined,
): boolean {
  return String(result?.orderId ?? "").trim().length > 0;
}

export const predictFunProvider: PlatformProvider = {
  async getBalance(account: PlatformAccount): Promise<AccountBalanceResult | undefined> {
    try {
      const session = await preparePredictFunUserSession(account);
      // 顺带校验 API 鉴权（JWT 内存缓存）；失败不挡链上余额，但打日志
      try {
        await session.getJwt();
      }
      catch (err) {
        console.warn("[PredictFun] JWT 签发失败（余额仍可读链上 USDT）", err);
      }
      const wei = await session.orderBuilder.balanceOf("USDT", session.maker);
      const balance = predictFunUsdtFromWei(wei);
      const predictAccount = resolvePredictFunPredictAccount(parsePredictFunTokenConfig(account.token))
        || session.maker;
      return {
        balance,
        currency: "USDT",
        venueMemberId: predictAccount,
        venueAccountName: predictAccount,
      };
    }
    catch (err) {
      console.warn("[PredictFun] getBalance failed", err);
      // 保存探测需要真实错误文案；勿吞成 undefined
      throw err instanceof Error ? err : new Error(String(err));
    }
  },

  async checkBet(account: PlatformAccount, option: BetOption): Promise<BetOption> {
    const tokenId = String(option.itemId ?? "").trim();
    const marketId = await ensureMarketId(option, tokenId);
    const detectionOdds = resolveDetectionOdds(option);
    const rawMaxPrice = resolvePredictFunDetectionMaxPriceRaw(option, detectionOdds);
    const maxPrice = resolvePredictFunDetectionMaxPrice(option, detectionOdds);
    const apiBetMoney = resolveApiBetMoney(option);

    try {
      if (!account?.accountId)
        throw new Error("PredictFun 账号缺少 playerId");
      if (!marketId)
        throw new Error("缺少 Predict.fun marketId（请确认采集器已写入 fo）");

      const prior = option.data;
      const now = Date.now();
      if (
        isPredictFunBuyCheckData(prior)
        && prior.tokenId === tokenId
        && prior.marketId === marketId
        && prior.detectionOdds === detectionOdds
        && prior.detectionMaxPrice === maxPrice
        && prior.apiBetMoney === apiBetMoney
        && now - prior.bookFetchedAt <= PRECHECK_BOOK_REUSE_MS
      ) {
        option.odds = prior.odds;
        option.newOdds = prior.odds;
        return option;
      }

      const checked = await checkPredictFunUserBuy({
        account,
        marketId,
        tokenId,
        apiBetMoney,
        detectionMaxPrice: maxPrice,
        detectionOdds,
      });
      applyCheckResult(option, checked, detectionOdds, apiBetMoney, maxPrice, rawMaxPrice);
    }
    catch (err) {
      option.checkError = err instanceof Error ? err.message : String(err);
      option.data = null;
    }
    return option;
  },

  async betting(account: PlatformAccount, option: BetOption): Promise<BetResult> {
    const beginTime = Date.now();
    const check = option.data as PredictFunBuyCheckData | null | undefined;
    if (!isPredictFunBuyCheckData(check))
      return new BetResult(PLATFORM, false, "请先通过 checkBet 预检");
    if (!account?.accountId)
      return new BetResult(PLATFORM, false, "PredictFun 账号缺少 playerId");

    const tokenId = String(option.itemId ?? "").trim();
    const detectionOdds = resolveDetectionOdds(option);
    // 与预检同一执行限价，禁止再次 resolve 造成 check/submit 漂移
    const maxPrice = isValidPredictClobPrice(Number(check.detectionMaxPrice))
      ? Number(check.detectionMaxPrice)
      : resolvePredictFunDetectionMaxPrice(option, detectionOdds);
    const apiBetMoney = resolveApiBetMoney(option);
    const display = buildPfOrderDisplayLabels(option);

    try {
      const signed = await signPredictFunUserMarketBuy({
        account,
        marketId: check.marketId,
        tokenId,
        apiBetMoney,
        maxPrice,
        feeRateBps: check.feeRateBps,
        isNegRisk: check.isNegRisk,
        isYieldBearing: check.isYieldBearing,
      });

      const submitted = await pfSubmitSignedOrder(account, {
        jwt: signed.jwt,
        createOrderBody: signed.createOrderBody,
        marketId: check.marketId,
        tokenId,
        apiBetMoney,
        detectionMaxPrice: maxPrice,
        detectionOdds,
        bookPrice: signed.bookPrice,
        bookOdds: signed.bookOdds,
        makerUsdt: signed.makerUsdt,
        sharesWei: signed.sharesWei,
        feeRateBps: signed.feeRateBps,
        orderHash: signed.orderHash,
        match: display.match,
        bet: display.bet,
        item: display.item,
      });

      if (!isPredictFunOrderAccepted(submitted)) {
        return new BetResult(
          PLATFORM,
          false,
          "Predict.fun 下单未受理",
          check,
          submitted,
        );
      }

      option.newOdds = Number(submitted.bookOdds) || option.newOdds;
      const orderId = String(submitted.orderId ?? "").trim();
      const bet = new BetResult(
        PLATFORM,
        true,
        `${orderId} / ${submitted.code ?? "accepted"} / 待官方订单确认`,
        check,
        submitted,
      );
      bet.orderId = orderId || null;
      bet.pending = true;
      bet.beginTime = beginTime;
      return bet;
    }
    catch (err) {
      return new BetResult(
        PLATFORM,
        false,
        err instanceof Error ? err.message : String(err),
      );
    }
  },

  async getOrders(account: PlatformAccount): Promise<VenueOrder[]> {
    try {
      return await pfGetOrders(account);
    }
    catch (err) {
      console.warn("[PredictFun] getOrders failed", err);
      return [];
    }
  },

  resolveLegOutcome(account, result, opts?: ResolveLegOutcomeOpts) {
    return resolvePredictFunProviderLegOutcome(
      acc => pfGetOrders(acc),
      account,
      result,
      opts,
    );
  },
};

export { detectionMaxPriceFromOdds };

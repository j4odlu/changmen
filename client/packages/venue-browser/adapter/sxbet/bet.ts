import type {
  PlatformProvider,
  ResolveLegOutcomeOpts,
  VenueOrder,
} from "../contract";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { PLATFORMS } from "../shared/platforms";
import {
  SXBET_USDC,
  fetchSxBestOdds,
  fetchSxTrades,
  fetchSxUsdcBalance,
  type SxTradeRow,
} from "./api";
import {
  parseSxBetTokenConfig,
  resolveSxBetPrivateKey,
} from "./credentials";
import { resolveSxBetProviderLegOutcome } from "./legOutcome";
import {
  bestSxDecimalOddsFromBestRow,
  sxDesiredProtocolOddsFromBestRow,
  sxProtocolOddsToDecimal,
} from "./parse";
import {
  checksumSxAddress,
  fillSxOrder,
  parseSxTradeNetReturnUsdc,
  parseSxTradeStakeUsdc,
  walletFromSxPrivateKey,
} from "./orders";

const PLATFORM = PLATFORMS.SXBet;
const PRECHECK_REUSE_MS = 800;
const DEFAULT_ODDS_SLIPPAGE = 1;
/** 官方 taker 最低 1 USDC */
const MIN_STAKE_USDC = 1;

export interface SxBetCheckData {
  marketHash: string;
  isTakerBettingOutcomeOne: boolean;
  odds: number;
  detectionOdds: number;
  desiredOdds: string;
  stakeUsdc: number;
  oddsSlippage: number;
  bookFetchedAt: number;
  side: "BUY";
}

function resolveStakeUsdc(option: BetOption): number {
  const value = Number(option.betMoney);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`无效买入金额 ${option.betMoney}`);
  const stake = Math.round(value * 100) / 100;
  if (stake < MIN_STAKE_USDC)
    throw new Error(`SXBet 最低下注 ${MIN_STAKE_USDC} USDC`);
  return stake;
}

function resolveDetectionOdds(option: BetOption): number {
  const data = option.data as { detectionOdds?: number } | null | undefined;
  const fromData = Number(data?.detectionOdds);
  if (Number.isFinite(fromData) && fromData > 1)
    return fromData;
  return option.odds;
}

function resolveMarketHash(option: BetOption): string {
  const fromData = option.data as { marketHash?: string } | null | undefined;
  const fromBetId = String(option.betId ?? "").trim();
  const fromItem = String(option.itemId ?? "").trim();
  // itemId 形如 marketHash:1 / marketHash:2
  const fromOutcome = fromItem.includes(":") ? fromItem.split(":")[0]! : "";
  return String(fromData?.marketHash ?? (fromBetId || fromOutcome)).trim();
}

function resolveIsOutcomeOne(option: BetOption): boolean {
  if (option.target === "Away")
    return false;
  if (option.target === "Home")
    return true;
  const itemId = String(option.itemId ?? "");
  if (itemId.endsWith(":2"))
    return false;
  return true;
}

function accountPrivateKey(account: PlatformAccount): string {
  return resolveSxBetPrivateKey(parseSxBetTokenConfig(account.token));
}

function isSxBetCheckData(data: unknown): data is SxBetCheckData {
  if (!data || typeof data !== "object")
    return false;
  const row = data as SxBetCheckData;
  return row.side === "BUY"
    && Boolean(row.marketHash)
    && typeof row.isTakerBettingOutcomeOne === "boolean"
    && Number.isFinite(row.odds) && row.odds > 1
    && Boolean(row.desiredOdds)
    && Number.isFinite(row.stakeUsdc) && row.stakeUsdc > 0
    && Number.isFinite(row.bookFetchedAt) && row.bookFetchedAt > 0;
}

function buildOrderDisplay(option: BetOption): { match: string; bet: string; item: string; game: string } {
  const bet = option.bet;
  const match = option.match;
  const home = String(bet?.homeName ?? "").trim();
  const away = String(bet?.awayName ?? "").trim();
  const title = String(match?.title ?? "").trim();
  return {
    match: title || (home && away ? `${home} vs ${away}` : ""),
    bet: bet?.getBetName?.() || "全场胜负",
    item: option.target === "Away" ? (away || "客队") : (home || "主队"),
    game: String(match?.game ?? ""),
  };
}

function mapTradeToVenueOrder(account: PlatformAccount, trade: SxTradeRow): VenueOrder {
  const stake = parseSxTradeStakeUsdc(trade);
  const odds = sxProtocolOddsToDecimal(trade.odds ?? trade.percentageOdds) || 0;
  const reward = parseSxTradeNetReturnUsdc(trade.netReturn);
  const settleValue = Number(trade.settleValue);
  const statusRaw = String(trade.tradeStatus ?? "").toUpperCase();
  let status: VenueOrder["status"] = "pending";
  if (statusRaw === "FAILED")
    status = "reject";
  else if (statusRaw === "SUCCESS" || statusRaw === "SETTLED" || statusRaw === "PENDING") {
    if (trade.settled === true) {
      const payout = Number.isFinite(settleValue) ? settleValue : reward;
      status = payout > stake ? "win" : "lose";
    }
    else if (statusRaw === "SUCCESS" || statusRaw === "SETTLED") {
      status = "none";
    }
    else {
      status = "pending";
    }
  }

  const created = trade.createdAt
    ? (typeof trade.createdAt === "number"
      ? (trade.createdAt > 1e12 ? trade.createdAt : trade.createdAt * 1000)
      : Date.parse(String(trade.createdAt)) || Date.now())
    : Date.now();

  return {
    provider: account.provider ?? PLATFORM,
    orderId: String(trade.fillHash || trade.fillOrderHash || trade.tradeHash || "").trim(),
    odds,
    createAt: created,
    betMoney: stake,
    reward,
    money: 0,
    status,
    game: String(trade.leagueLabel ?? ""),
    match: [trade.teamOneName, trade.teamTwoName].filter(Boolean).join(" vs "),
    bet: "全场胜负",
    item: trade.bettingOutcomeOne === false
      ? String(trade.teamTwoName ?? "客队")
      : String(trade.teamOneName ?? "主队"),
  };
}

export const sxbetProvider: PlatformProvider = {
  async getBalance(account) {
    try {
      const key = accountPrivateKey(account);
      if (!key)
        return undefined;
      const wallet = walletFromSxPrivateKey(key);
      const balance = await fetchSxUsdcBalance(checksumSxAddress(wallet.address));
      return { balance, currency: "USD" };
    }
    catch (err) {
      console.warn("[SXBet] getBalance failed", err);
      return undefined;
    }
  },

  async checkBet(account, option) {
    try {
      if (!accountPrivateKey(account))
        throw new Error("SXBet 账号 token 需含 privateKey（JSON）");
      const marketHash = resolveMarketHash(option);
      if (!marketHash)
        throw new Error("缺少 SXBet marketHash");
      const isTakerBettingOutcomeOne = resolveIsOutcomeOne(option);
      const detectionOdds = resolveDetectionOdds(option);
      const stakeUsdc = resolveStakeUsdc(option);
      const prior = option.data;
      const now = Date.now();
      if (
        isSxBetCheckData(prior)
        && prior.marketHash === marketHash
        && prior.isTakerBettingOutcomeOne === isTakerBettingOutcomeOne
        && prior.detectionOdds === detectionOdds
        && prior.stakeUsdc === stakeUsdc
        && now - prior.bookFetchedAt <= PRECHECK_REUSE_MS
      ) {
        option.odds = prior.odds;
        option.newOdds = prior.odds;
        return option;
      }

      const best = await fetchSxBestOdds([marketHash], SXBET_USDC);
      const row = best[marketHash];
      const bookOdds = bestSxDecimalOddsFromBestRow(row, isTakerBettingOutcomeOne);
      if (!bookOdds)
        throw new Error("盘口无可用赔率");
      if (detectionOdds > 1 && bookOdds + 1e-9 < detectionOdds)
        throw new Error(`赔率下滑 ${bookOdds} < 检测 ${detectionOdds}`);

      const desiredOdds = sxDesiredProtocolOddsFromBestRow(row, isTakerBettingOutcomeOne);
      if (!desiredOdds || desiredOdds === "0")
        throw new Error("无法推导 desiredOdds");
      option.odds = bookOdds;
      option.newOdds = bookOdds;
      option.data = {
        marketHash,
        isTakerBettingOutcomeOne,
        odds: bookOdds,
        detectionOdds,
        desiredOdds,
        stakeUsdc,
        oddsSlippage: DEFAULT_ODDS_SLIPPAGE,
        bookFetchedAt: Date.now(),
        side: "BUY",
      } satisfies SxBetCheckData;
      option.checkError = undefined;
    }
    catch (err) {
      option.checkError = err instanceof Error ? err.message : String(err);
      option.data = null;
    }
    return option;
  },

  async betting(account, option) {
    const beginTime = Date.now();
    const check = option.data as SxBetCheckData | null | undefined;
    if (!isSxBetCheckData(check))
      return new BetResult(PLATFORM, false, "请先通过 checkBet 预检");
    const privateKey = accountPrivateKey(account);
    if (!privateKey)
      return new BetResult(PLATFORM, false, "SXBet 缺少私钥");

    try {
      const filled = await fillSxOrder({
        privateKey,
        marketHash: check.marketHash,
        isTakerBettingOutcomeOne: check.isTakerBettingOutcomeOne,
        stakeUsdc: check.stakeUsdc,
        desiredOdds: check.desiredOdds,
        oddsSlippage: check.oddsSlippage,
      });
      const avgOdds = sxProtocolOddsToDecimal(filled.averageOdds) || check.odds;
      option.newOdds = avgOdds;
      const bet = new BetResult(
        PLATFORM,
        true,
        `${filled.fillHash}${filled.isPartialFill ? " / partial" : ""} / 待链上确认`,
        check,
        filled.response,
      );
      bet.orderId = filled.fillHash;
      bet.pending = true;
      bet.beginTime = beginTime;
      return bet;
    }
    catch (err) {
      return new BetResult(
        PLATFORM,
        false,
        err instanceof Error ? err.message : String(err),
        check,
      );
    }
  },

  async getOrders(account) {
    try {
      const key = accountPrivateKey(account);
      if (!key)
        return [];
      const wallet = walletFromSxPrivateKey(key);
      const trades = await fetchSxTrades({
        bettor: checksumSxAddress(wallet.address),
        pageSize: 50,
      });
      return trades
        .map(row => mapTradeToVenueOrder(account, row))
        .filter(row => row.orderId);
    }
    catch (err) {
      console.warn("[SXBet] getOrders failed", err);
      return [];
    }
  },

  resolveLegOutcome(account, result, opts?: ResolveLegOutcomeOpts) {
    return resolveSxBetProviderLegOutcome(account, result, opts);
  },
};

export { buildOrderDisplay as buildSxOrderDisplayLabels };

import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { POLYMARKET_MIN_VENUE_STAKE } from "@changmen/shared/account_multiply";
import { Currency, getExchange } from "@changmen/shared/currency";

/** PM 下注 USDC 精度：小数点后 2 位 */
export function round2Usdc(n: number): number {
  if (!Number.isFinite(n))
    return 0;
  return Math.round(n * 100) / 100;
}

function resolvePolymarketEffectiveRate(account: PlatformAccount, odds: number): number {
  if (!account.rateConfig?.length)
    return 1;
  const row = account.rateConfig.find(
    r =>
      (r.minOdds === 0 || r.minOdds <= odds) && (r.maxOdds === 0 || r.maxOdds >= odds),
  );
  let rate = row?.rate ?? 0;
  if (rate === 0)
    rate = 1;
  return rate;
}

/** CNY 计划额 → PM 场馆 USDC（保留 2 位小数；汇率走 A8 getExchange） */
export function polymarketUsdtFromCny(
  account: PlatformAccount,
  cnyAmount: number,
  odds: number,
  skipAccountRate = false,
): number {
  let usdt = round2Usdc(cnyAmount / getExchange(account.currency));
  if (skipAccountRate || !account.rateConfig?.length)
    return usdt;
  const rate = resolvePolymarketEffectiveRate(account, odds);
  if (usdt < 1)
    return usdt;
  return round2Usdc(usdt * rate);
}

/** PM 场馆 USDC → CNY 计划额（与 round2Usdc 对齐，避免 round-trip 漂移） */
export function polymarketCnyFromUsdt(usdtAmount: number): number {
  return round2Usdc(round2Usdc(usdtAmount) * getExchange(Currency.USDT));
}

/** checkBet / betting 最终下单 USDC */
export function resolvePolymarketVenueStakeUsdc(betMoney: number): number {
  const stake = round2Usdc(Number(betMoney) || 0);
  if (stake <= 0)
    return 0;
  return Math.max(POLYMARKET_MIN_VENUE_STAKE, stake);
}

/** 对齐 A8 bundle `Pr.exchange` / `Pr.getExchange` / `Pr.getCurrency` */
export const Currency = {
  CNY: "CNY",
  USDT: "USDT",
} as const;

export type CurrencyCode = (typeof Currency)[keyof typeof Currency];

const EXCHANGE = new Map<string, number>([
  [Currency.CNY, 1],
  // [changmen 扩展] 固定折算价 1U = 6.65 CNY；不沿用 A8 的历史汇率。
  [Currency.USDT, 6.65],
]);

/** 场馆默认结算币：未回写 currency 时按 provider 判定 */
const USDT_PROVIDERS = new Set([
  "Polymarket",
  "PredictFun",
  "Stake",
  "XBet",
]);

export function getExchange(currency?: string | null): number {
  return EXCHANGE.get(currency ?? Currency.CNY) ?? 1;
}

/** 对齐 A8 `Pr.getCurrency` */
export function getCurrency(raw?: string | null): CurrencyCode {
  if (!raw)
    return Currency.CNY;
  switch (String(raw).trim().toUpperCase()) {
    case "CNY":
    case "RMB":
      return Currency.CNY;
    case "USD":
    case "USDT":
    case "USDC":
      return Currency.USDT;
    default:
      return Currency.CNY;
  }
}

/** 场馆未带 currency 时的默认币种 */
export function defaultCurrencyForProvider(provider?: string | null): CurrencyCode {
  const id = String(provider || "").trim();
  if (USDT_PROVIDERS.has(id))
    return Currency.USDT;
  return Currency.CNY;
}

/**
 * 账号展示/记账币种：
 * - USDT 场馆（Polymarket / PredictFun 等）固定 USDT
 * - 其它场馆：有显式 currency → getCurrency；否则 CNY
 */
export function resolveAccountCurrency(
  provider?: string | null,
  raw?: string | null,
): CurrencyCode {
  const venueDefault = defaultCurrencyForProvider(provider);
  if (venueDefault === Currency.USDT)
    return Currency.USDT;
  if (raw != null && String(raw).trim() !== "")
    return getCurrency(raw);
  return venueDefault;
}

export const MONEY_CURRENCIES: CurrencyCode[] = [Currency.CNY, Currency.USDT];

/** 场馆 USDT/USDC 原币 → Plan CNY 展示口径（对齐 A8 `uv.getBalance` × exchange） */
export function scaleUsdtToCnyDisplay(usdt: number): number {
  if (!Number.isFinite(usdt))
    return 0;
  return usdt * getExchange(Currency.USDT);
}

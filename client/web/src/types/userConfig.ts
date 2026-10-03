import type { PlatformId } from "@changmen/api-contract";
import type { UserConfig } from "@changmen/client-core/types/userConfig";
import { ALL_PLATFORMS } from "@changmen/venue-adapter/registry";
import { normalizeWaitTime } from "@/shared/betTiming";

export type { UserConfig, BetSorting } from "@changmen/client-core/types/userConfig";
export { ALL_PLATFORMS };

export function createDefaultUserConfig(): UserConfig {
  return {
    betting: false,
    bettingAutoOpen: false,
    bettingAutoOpenTime: 0,
    betMoney: 100,
    betMoneyMode: "buy",
    minMoney: 0,
    maxMoney: 0,
    tenNumber: false,
    makeUp: false,
    makeUp_odds: 0,
    makeUp_defaultOdds: 0,
    makeProfit: 1.01,
    noSameProvider: false,
    noSameBet: false,
    allowSameBet: ["PB"],
    anyOdds: false,
    anyOddsProfit: 0.95,
    betSorting: "Custom",
    winRateValue: 0.15,
    providerSortValue: [...ALL_PLATFORMS],
    providerFixed: [],
    profit: 1.03,
    maxProfit: 1.2,
    minOdds: 1.3,
    maxOdds: 10,
    betCount: 0,
    betInterval: 30,
    checkTimeout: 3000,
    betChecked: false,
    singleBet: false,
    waitTime: {},
    valueBetMoney: 100,
    valueBetConfirm: true,
  };
}

/** [A8 可证实] D8 加载：保留用户顺序，将 ALL_PLATFORMS 中缺失的平台 append 到末尾 */
export function mergeProviderSortValue(values: PlatformId[]): PlatformId[] {
  const merged = [...values];
  for (const platform of ALL_PLATFORMS) {
    if (!merged.includes(platform))
      merged.push(platform);
  }
  return merged;
}

export function mergeUserConfig(raw: Partial<UserConfig> | null | undefined): UserConfig {
  const base = createDefaultUserConfig();
  if (!raw || typeof raw !== "object")
    return base;
  const {
    arbDetectEngine: _legacyDetectEngine,
    arbExecuteEngine: _legacyExecuteEngine,
    ...rest
  } = raw as Partial<UserConfig> & {
    arbDetectEngine?: unknown;
    arbExecuteEngine?: unknown;
  };
  return {
    ...base,
    ...rest,
    betMoneyMode: raw.betMoneyMode === "total" ? "total" : "buy",
    providerSortValue: mergeProviderSortValue(
      Array.isArray(raw.providerSortValue)
        ? (raw.providerSortValue as PlatformId[])
        : base.providerSortValue,
    ),
    providerFixed: Array.isArray(raw.providerFixed)
      ? (raw.providerFixed as PlatformId[])
      : base.providerFixed,
    allowSameBet: Array.isArray(raw.allowSameBet)
      ? (raw.allowSameBet as PlatformId[])
      : base.allowSameBet,
    waitTime: normalizeWaitTime(
      raw.waitTime && typeof raw.waitTime === "object"
        ? (raw.waitTime as Record<string, unknown>)
        : undefined,
    ),
    valueBetMoney: normalizeValueBetMoney(raw.valueBetMoney, base.valueBetMoney),
    valueBetConfirm: raw.valueBetConfirm !== false,
  };
}

/** 正 EV 建议注码：非法/缺省回退默认；允许 0（不展示金额） */
export function normalizeValueBetMoney(raw: unknown, fallback = 100): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0)
    return fallback;
  return Math.round(n);
}

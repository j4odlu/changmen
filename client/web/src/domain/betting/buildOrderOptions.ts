import type { ViewBet, ViewMatch } from "@/models/match";
import type { PlatformAccount } from "@/models/platformAccount";
import type { PlatformId } from "@/types/esport";
import type { UserConfig } from "@/types/userConfig";
import { initialArbBaseStake, pickArbLegs } from "@changmen/arb-core";
import { BetOption } from "@changmen/client-core/models/betOption";
import { sortOptionsByWinRate } from "@/shared/winRate";
import { capturePmTickBufferQuote } from "@/domain/polymarket/tickBufferQuote";

/** 对齐 A8 `IQ.GetOrderOptions`：选腿 + 对冲金额 + betSorting */
export function buildOrderOptions(
  bet: ViewBet,
  match: ViewMatch,
  config: UserConfig,
  accounts: PlatformAccount[] = [],
  /** 对齐 A8 `Io().getProviders()` 的 keys */
  providerKeys: PlatformId[],
): BetOption[] | undefined {
  const totalMode = config.betMoneyMode === "total";
  if (totalMode && (!Number.isFinite(config.betMoney) || config.betMoney <= 0))
    return undefined;
  const legs = pickArbLegs(bet, config, providerKeys, accounts, match.game);
  if (!legs)
    return undefined;

  const { homeItem, awayItem, homeOdds, awayOdds } = legs;
  let betMoney = initialArbBaseStake(homeOdds, awayOdds, config);
  const low = Math.min(homeOdds, awayOdds);
  const high = Math.max(homeOdds, awayOdds);
  let hedgeMoney = (low * betMoney) / high;
  if (config.tenNumber)
    hedgeMoney = Math.round(hedgeMoney / 10) * 10;
  else if (totalMode) {
    // [changmen 扩展] 以分为单位分配余款，避免两腿独立四舍五入后超出合计金额。
    const baseCents = Math.round(betMoney * 100);
    const totalCents = Math.round(config.betMoney * 100);
    betMoney = baseCents / 100;
    hedgeMoney = (totalCents - baseCents) / 100;
  }

  const options: BetOption[]
    = homeOdds < awayOdds
      ? [
          new BetOption(match, bet, homeItem, "Home", betMoney),
          new BetOption(match, bet, awayItem, "Away", hedgeMoney),
        ]
      : [
          new BetOption(match, bet, awayItem, "Away", betMoney),
          new BetOption(match, bet, homeItem, "Home", hedgeMoney),
        ];

  // [changmen 扩展] 小额/十位取整可能产生零注码，禁止以不完整双腿进入预检。
  try { for (const option of options) capturePmTickBufferQuote(option); }
  catch { return undefined; }
  if (totalMode && options.some(o => !Number.isFinite(o.betMoney) || o.betMoney <= 0))
    return undefined;

  switch (config.betSorting) {
    case "Low":
      options.sort((a, b) => (a.odds < b.odds ? -1 : 1));
      break;
    case "High":
      options.sort((a, b) => (a.odds > b.odds ? -1 : 1));
      break;
    case "Parallel":
      break;
    case "WinRate": {
      const byWinRate = sortOptionsByWinRate(options, config);
      if (byWinRate) {
        options.splice(0, options.length, ...byWinRate);
      }
      else {
        options.sort(
          (a, b) =>
            config.providerSortValue.indexOf(a.type)
            - config.providerSortValue.indexOf(b.type),
        );
      }
      break;
    }
    case "Custom":
      options.sort(
        (a, b) =>
          config.providerSortValue.indexOf(a.type) - config.providerSortValue.indexOf(b.type),
      );
      break;
    default:
      options.sort(
        (a, b) =>
          config.providerSortValue.indexOf(a.type) - config.providerSortValue.indexOf(b.type),
      );
  }

  if (options.some(o => config.providerFixed.includes(o.type))) {
    options.sort(
      (a, b) => config.providerFixed.indexOf(b.type) - config.providerFixed.indexOf(a.type),
    );
  }

  return options;
}

import type { PlatformId } from "@changmen/api-contract";
import type { BetSide, ViewBet, ViewBetItem } from "@changmen/client-core/models/match";
import type { UserConfig } from "@changmen/client-core/types/userConfig";
import type { ArbProfitAccount } from "../types";
import { pickArbLegs, type ArbLegs } from "./pickArbLegs";

/** [changmen 扩展] 检测、订单构建、连线共用的选腿快照。ID 和赔率冻结，DOM 不进入检测层。 */
export interface ArbLegDetection extends Readonly<ArbLegs> {
  readonly homeItemId: string;
  readonly awayItemId: string;
}

interface CachedDetection {
  inputs: readonly unknown[];
  result: ArbLegDetection | undefined;
}

// 按盘口对象弱引用；每盘只保留少量范围/配置，盘口移除后可被回收。
const cache = new WeakMap<ViewBet, CachedDetection[]>();
const MAX_VARIANTS = 4;

/**
 * 同一盘口、报价、平台范围与选腿参数复用同一个检测结果（含无机会）。
 * 每次仍读取报价以建立 Vue 调用方的依赖，并确认缓存有效；不使用计时 TTL，
 * 变价/锁盘/选项替换/阈值或账号利润覆盖变化均立即重新检测。
 */
export function detectArbLegs(
  bet: ViewBet,
  config: UserConfig,
  providerKeys: PlatformId[],
  accounts: ArbProfitAccount[] = [],
  gameName?: string,
): ArbLegDetection | undefined {
  if (!config) return undefined;
  const inputs: unknown[] = [gameName, config.minOdds, config.profit, config.maxProfit,
    config.noSameBet, ...(config.allowSameBet ?? []), "providers", ...[...new Set(providerKeys)].sort(), "accounts"];
  for (const account of accounts) inputs.push(account.provider, account.profit);
  inputs.push("quotes");
  const quotes = new Map<ViewBetItem, Record<BetSide, number>>();
  for (const item of bet.items) {
    const odds = { Home: item.getOdds("Home"), Away: item.getOdds("Away") };
    quotes.set(item, odds);
    inputs.push(item, item.type, item.homeId, item.awayId, odds.Home, odds.Away);
  }
  const variants = cache.get(bet) ?? [];
  const previous = variants.find(entry => entry.inputs.length === inputs.length
    && entry.inputs.every((value, index) => Object.is(value, inputs[index])));
  if (previous) return previous.result;

  const legs = pickArbLegs(bet, config, providerKeys, accounts, gameName,
    (item, side) => quotes.get(item)![side]);
  const unchanged = legs && variants.find(entry => entry.result
    && entry.result.homeItem === legs.homeItem && entry.result.awayItem === legs.awayItem
    && entry.result.homeItemId === legs.homeItem.homeId && entry.result.awayItemId === legs.awayItem.awayId
    && Object.is(entry.result.homeOdds, legs.homeOdds) && Object.is(entry.result.awayOdds, legs.awayOdds))?.result;
  const result = unchanged || (legs ? Object.freeze({ ...legs,
    homeItemId: legs.homeItem.homeId, awayItemId: legs.awayItem.awayId,
  }) : undefined);
  cache.set(bet, [{ inputs, result }, ...variants].slice(0, MAX_VARIANTS));
  return result;
}

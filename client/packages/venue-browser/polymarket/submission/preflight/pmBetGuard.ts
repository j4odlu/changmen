import { measurePmExecution } from "../../pmExecutionMetrics";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { getPolymarketMarketBlockReason } from "../../markets/pmMarketGuard";
import {
  fetchClobMarketByConditionId,
  fetchGammaEventById,
  fetchGammaMarketByTokenId,
  gammaEventToPmSportLike,
  type GammaEventLike,
} from "../../markets/pmSportGamma";
import {
  getPolymarketPmSportBlockReason,
  getPolymarketPmSportBlockReasonFromOption,
} from "../../markets/pmSportGuard";

/** 下单前综合赛况闸：本地 pm_sport → Gamma 兜底 → outcomePrices */
export async function resolvePolymarketBetBlockReason(option: BetOption, requireClobConfirmation = false): Promise<string | null> {
  const local = getPolymarketPmSportBlockReasonFromOption(option);
  if (local)
    return local;

  try {
    const conditionId = String(option.betId ?? "").trim();
    const eventId = String(option.match?.providers?.Polymarket ?? "").trim();
    const [gammaSettled, clobSettled, eventSettled] = await Promise.allSettled([
      measurePmExecution("gamma", { tokenId: option.itemId, stage: "gamma_market" }, () => fetchGammaMarketByTokenId(option.itemId)),
      conditionId ? measurePmExecution("gamma", { tokenId: option.itemId, stage: "clob_market" }, () => fetchClobMarketByConditionId(conditionId)) : Promise.resolve(null),
      eventId ? measurePmExecution("gamma", { tokenId: option.itemId, stage: "gamma_event" }, () => fetchGammaEventById(eventId)) : Promise.resolve(null),
    ]);
    const market = gammaSettled.status === "fulfilled" ? gammaSettled.value : null;
    const clob = clobSettled.status === "fulfilled" ? clobSettled.value : null;
    const latestLocal = getPolymarketPmSportBlockReasonFromOption(option);
    if (latestLocal) return latestLocal;

    // [changmen 扩展] 每轮都查共享短缓存；WS 接收时间不能豁免交易赛况检查。
    let gammaPm = eventSettled.status === "fulfilled" ? gammaEventToPmSportLike(eventSettled.value) : null;
    if (!gammaPm && market) {
      const events = Array.isArray(market.events) ? market.events : [];
      const embedded = events[0] as GammaEventLike | undefined;
      if (embedded)
        gammaPm = gammaEventToPmSportLike(embedded);
    }
    const gammaReason = getPolymarketPmSportBlockReason(gammaPm, option.bet?.round);
    if (gammaReason)
      return `${gammaReason}（Gamma）`;

    // CLOB 行优先：Gamma 仍显示接单时 CLOB 可能已 trading is disabled
    const clobReason = getPolymarketMarketBlockReason(clob, option.itemId);
    if (clobReason)
      return clobReason;
    const marketReason = getPolymarketMarketBlockReason(market, option.itemId);
    if (marketReason)
      return marketReason;
    if (requireClobConfirmation && (clob?.accepting_orders ?? clob?.acceptingOrders) !== true)
      return "PM CLOB 接单状态未知，跳过本轮自动套利";
  }
  catch (err) {
    console.warn("[Polymarket] bet guard gamma check failed", err);
    if (requireClobConfirmation) return "PM CLOB 接单状态未知，跳过本轮自动套利";
  }

  return null;
}

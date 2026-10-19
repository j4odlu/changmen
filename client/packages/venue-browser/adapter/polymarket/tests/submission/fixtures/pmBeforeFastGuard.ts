import type { BetOption } from "@changmen/client-core/models/betOption";
import type { PolymarketRawMarket } from "../../../parse";
import { getPolymarketMarketBlockReason } from "../../../pmMarketGuard";
import { getPolymarketPmSportBlockReason, getPolymarketPmSportBlockReasonFromOption } from "../../../pmSportGuard";
import { fetchClobMarketByConditionId, fetchGammaEventById, fetchGammaMarketByTokenId, gammaEventToPmSportLike } from "../../../pmSportGamma";
import { getPmGammaEvidence } from "../../../markets/pmGammaCache";
import { recordPmExecutionMetric } from "../../../pmExecutionMetrics";

/** [changmen 扩展] 只供优化 FOK 使用。市场状态与冷门价格风控分开，价格/深度由本轮 book 决定。 */
function tradingBlock(market: PolymarketRawMarket | null, tokenId: string) {
  return market ? getPolymarketMarketBlockReason({ ...market, outcomePrices: undefined, outcome_prices: undefined }, tokenId) : null;
}

export async function resolveOptimizedFokBlockReason(option: BetOption, automatic = false): Promise<string | null> {
  const local = getPolymarketPmSportBlockReasonFromOption(option);
  if (local) return local;
  const conditionId = String(option.betId ?? "").trim();
  const eventId = String(option.match?.providers?.Polymarket ?? "").trim();
  const query = async <T extends object>(stage: string, load: () => Promise<T | null>, gamma = true) => {
    const started = performance.now();
    try {
      const value = await load();
      const evidence = gamma ? getPmGammaEvidence(value) : null;
      recordPmExecutionMetric({ kind: "gamma", stage, tokenId: option.itemId, preflightMode: "optimized",
        ms: performance.now() - started, success: value !== null,
        ...(evidence ? { gammaSource: evidence.source, requestStartedAt: evidence.requestedAt,
          responseReceivedAt: evidence.receivedAt, requestMs: evidence.requestMs, evidenceAgeMs: evidence.ageMs,
          evidenceFresh: evidence.fresh } : {}),
      });
      return value;
    } catch (error) {
      recordPmExecutionMetric({ kind: "gamma", stage, tokenId: option.itemId, preflightMode: "optimized",
        ms: performance.now() - started, success: false, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  };
  const [market, clob, event] = await Promise.all([
    query("gamma_market", () => fetchGammaMarketByTokenId(option.itemId)),
    conditionId ? query("clob_market", () => fetchClobMarketByConditionId(conditionId), false) : null,
    eventId ? query("gamma_event", () => fetchGammaEventById(eventId)) : null,
  ]);
  const latest = getPolymarketPmSportBlockReasonFromOption(option);
  if (latest) return latest;

  // 即使响应已超过复用窗口，明确的拒单/结束证据也不能被忽略。
  const clobBlock = tradingBlock(clob, option.itemId);
  if (clobBlock) return clobBlock;
  const marketBlock = tradingBlock(market, option.itemId);
  if (marketBlock) return marketBlock;
  const sports = [gammaEventToPmSportLike(event), ...(Array.isArray(market?.events)
    ? market.events.map(row => gammaEventToPmSportLike(row)) : [])];
  for (const sport of sports) {
    const reason = getPolymarketPmSportBlockReason(sport, option.bet?.round);
    if (reason) return `${reason}（Gamma）`;
  }

  // 低概率价格并不证明不可成交。保留诊断信号，不代替真实订单簿检查。
  const riskSignal = getPolymarketMarketBlockReason(market, option.itemId);
  if (riskSignal) recordPmExecutionMetric({ kind: "guard", stage: "price_risk_signal", preflightMode: "optimized",
    tokenId: option.itemId, riskSignal });

  if (automatic && (clob?.accepting_orders ?? clob?.acceptingOrders) !== true)
    return "PM CLOB 接单状态未知，跳过本轮自动套利";
  const hasFreshSport = (getPmGammaEvidence(event)?.fresh && sports[0] !== null)
    || (getPmGammaEvidence(market)?.fresh && sports.slice(1).some(Boolean));
  if (automatic && (eventId || option.match?.pmSport) && !hasFreshSport)
    return "PM 赛况查询失败或证据已过期，跳过本轮自动套利";
  return null;
}

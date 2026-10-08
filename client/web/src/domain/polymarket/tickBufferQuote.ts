import type { BetOption } from "@changmen/client-core/models/betOption";
import { getPmArbPriceBufferPrefs, resolvePmDisplayQuote, validatePmPriceQuote,
  type PmArbPriceBufferPrefs } from "@changmen/venue-adapter/polymarket";
import { useOddsStore } from "@/stores/oddsStore";

const policies = new WeakMap<BetOption, PmArbPriceBufferPrefs>();
/** [changmen 扩展] 同步建腿时冻结转换规则及完整报价，后续不按新行情/配置重算。 */
export function capturePmPriceQuote(option: BetOption): void {
  if (option.type !== "Polymarket") return;
  if (policies.has(option)) {
    if (policies.get(option)!.enabled && !option.data?.pmPriceQuote)
      throw new Error("PM 冻结报价缺失，请新建投注尝试");
    return;
  }
  const policy = getPmArbPriceBufferPrefs();
  policies.set(option, policy);
  if (!policy.enabled) return;
  const result = resolvePmDisplayQuote(option.itemId, useOddsStore().getPmQuoteEntry(option.itemId), policy);
  if (result.status !== "ready" || result.quote.displayOdds !== option.odds)
    throw new Error(policy.mode === "tick" ? "PM +1 tick 报价未就绪或已改变" : "PM 调整报价未就绪或已改变");
  const quote = validatePmPriceQuote(result.quote, option.itemId, option.odds);
  option.data = { ...option.data, pmPriceQuote: quote,
    ...(quote.mode === "tick" ? { pmBufferMode: "tick", pmTickQuote: quote } : {}),
    detectionOdds: quote.displayOdds, detectionMaxPrice: quote.cap, detectionClobPrice: quote.cap };
}
/** 旧调用方兼容；两种缓冲都通过同一模块。 */
export const capturePmTickBufferQuote = capturePmPriceQuote;
export function pmAttemptUsesTickBuffer(option: BetOption): boolean {
  const policy = policies.get(option);
  return policy?.enabled === true && policy.mode === "tick";
}
export function pmAttemptPricePolicy(option: BetOption): PmArbPriceBufferPrefs | undefined { return policies.get(option); }

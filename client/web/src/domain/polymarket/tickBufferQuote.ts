import type { BetOption } from "@changmen/client-core/models/betOption";
import { createPmTickBufferQuote, isPmTickBufferActive } from "@changmen/venue-adapter/polymarket";
import { useOddsStore } from "@/stores/oddsStore";

const modes = new WeakMap<BetOption, "percent" | "tick">();
/** [changmen 扩展] 同步建腿时冻结 tick 报价；百分比不改 data 或赔率。 */
export function capturePmTickBufferQuote(option: BetOption): void {
  if (option.type !== "Polymarket" || modes.has(option)) return;
  const mode = isPmTickBufferActive() ? "tick" : "percent";
  modes.set(option, mode);
  if (mode !== "tick") return;
  const row = useOddsStore().getEntry("Polymarket", option.itemId);
  const quote = row && !row.isLock ? createPmTickBufferQuote(option.itemId, Number(row.clobPrice)) : undefined;
  if (!quote || quote.displayOdds !== option.odds) throw new Error("PM +1 tick 报价未就绪或已改变");
  option.data = { ...option.data, pmBufferMode: "tick", pmTickQuote: quote,
    detectionOdds: quote.displayOdds, detectionMaxPrice: quote.cap, detectionClobPrice: quote.cap };
}
export function pmAttemptUsesTickBuffer(option: BetOption): boolean { return modes.get(option) === "tick"; }

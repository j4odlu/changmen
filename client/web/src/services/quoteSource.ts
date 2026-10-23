import type { DetectionQuoteSource } from "@/domain/betting/quoteSource";
import { useOddsStore } from "@/stores/oddsStore";

/** 每次仍在原有规则的读取位置解析当前 Pinia；不提前读取或复制报价。 */
export const storeQuoteSource: DetectionQuoteSource = {
  getEntry: (provider, itemId) => useOddsStore().getEntry(provider, itemId),
  getPmQuoteEntry: itemId => useOddsStore().getPmQuoteEntry(itemId),
};

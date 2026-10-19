import type { ReadonlyMarketSourcePort } from "@changmen/pm-market-data-browser";

/** [changmen 扩展] Bind read-only host callbacks without observing or reading during creation. */
export function createReadonlyMarketSource(
  observe: ReadonlyMarketSourcePort["observe"],
  subscribedAssets: ReadonlyMarketSourcePort["subscribedAssets"],
): ReadonlyMarketSourcePort {
  return Object.freeze({ observe, subscribedAssets });
}

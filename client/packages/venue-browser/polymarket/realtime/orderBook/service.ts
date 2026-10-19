import { PmOrderBookService as BrowserBookService } from "@changmen/pm-market-data-browser";
import type { WorkerPort } from "@changmen/pm-market-data-browser/serviceProtocol";
import { observePmMarketStream } from "../../marketStream";
import { getPolymarketQuoteConsumerAssetIds } from "../../marketQuoteHub";

export type { Admission, BookLease, DiagnosticChannel, BookConsumerPort } from "@changmen/pm-market-data-browser/service";
export { FULL_BOOK_READ_MS, FULL_BOOK_CATCHUPS } from "@changmen/pm-market-data-browser/service";
/** [changmen 扩展] Compatibility constructor only; all state lives in the browser package. */
export class PmOrderBookService extends BrowserBookService {
  constructor(allowed: () => boolean, createWorker: () => WorkerPort,
    roster = () => getPolymarketQuoteConsumerAssetIds("esport"), observe = observePmMarketStream) {
    super({ allowed, createWorker, source: { observe, subscribedAssets: roster }, monotonicNow: () => performance.now() });
  }
}

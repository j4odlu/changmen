/** [changmen 扩展] Independent passive service; starting it requires an application authorization. */
import { PmOrderBookService } from "./realtime/orderBook/service";
import type {} from "./marketData.worker";
export { PmOrderBookService };
export type { BookLease, Admission, BookConsumerPort } from "./realtime/orderBook/service";
export type { DepthView, FullBookView } from "./realtime/orderBook/bookStore";
export function createPmOrderBookService(allowed: () => boolean): PmOrderBookService {
  return new PmOrderBookService(allowed, () => new Worker(new URL("./marketData.worker.ts", import.meta.url), { type: "module", name: "pm-market-book" }));
}

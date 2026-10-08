import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import type { OrderRow } from "@/types/order";
import { delayedPmConfirmation } from "@changmen/shared/order_progress_evidence";
import { progressOrderRecords } from "./progressOrderRecords";

/** [changmen 扩展] 前后台共用同一只读 PM 判定，不参与下注或补单。 */
export function pmOrderConfirmation(events: readonly OrderObservationEvent[], orders: readonly OrderRow[] = []) {
  return delayedPmConfirmation(events, progressOrderRecords(orders));
}

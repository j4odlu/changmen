import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import type { OrderRow } from "@/types/order";
import { boundRayOrderConfirmation } from "@changmen/shared/order_progress_evidence";
import { progressOrderRecords } from "./progressOrderRecords";

/** [changmen 扩展] 组合判断单独携带依据，保留时间线原始事件。 */
export function boundRayOrderEvidence(events: readonly OrderObservationEvent[], orders: readonly OrderRow[]) {
  return boundRayOrderConfirmation(events, progressOrderRecords(orders));
}

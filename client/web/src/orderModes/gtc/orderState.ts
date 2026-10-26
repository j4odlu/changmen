import type { GtcOrderRecord } from "./core/orderRecord";
import type { GtcSyncIssue } from "./syncStatus";
import { reactive } from "vue";

export const gtcOrders = reactive({ owner: "", ready: false, records: [] as GtcOrderRecord[],
  queryIssues: {} as Record<string, GtcSyncIssue>, saveIssues: {} as Record<string, GtcSyncIssue>,
  resultIssues: {} as Record<string, GtcSyncIssue>,
  cancelInFlight: {} as Record<string, boolean>, error: "" });

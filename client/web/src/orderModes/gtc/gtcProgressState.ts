import type { GtcExecution } from "@changmen/shared/pm_gtc";
import type { GtcSyncIssue } from "./syncStatus";
import { reactive } from "vue";

/** [changmen 扩展] 展示状态没有执行/恢复副作用；普通 FOK 页面不加载 GTC 执行器。 */
export const gtcProgress = reactive({ owner: "", records: [] as GtcExecution[], error: "", ready: false, queryIssues: {} as Record<string, GtcSyncIssue>, otherQueryIssues: {} as Record<string, GtcSyncIssue>, saveIssues: {} as Record<string, GtcSyncIssue>, cancelInFlight: {} as Record<string, boolean>, recoveredAt: 0 });

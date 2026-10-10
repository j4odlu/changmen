import type { GtcExecution } from "@changmen/shared/pm_gtc";
import { reactive } from "vue";
import type { GtcSyncIssue } from "./syncStatus";

/** [changmen 扩展] 展示状态没有执行/恢复副作用；普通 FOK 页面不加载 GTC 执行器。 */
export const gtcProgress = reactive({ owner: "", records: [] as GtcExecution[], error: "", ready: false,
  queryIssues: {} as Record<string, GtcSyncIssue>, recoveredAt: 0 });

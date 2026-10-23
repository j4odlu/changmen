/** [changmen 扩展] 订单日志诊断兼容入口；查询、解析和结果投影由各职责模块实现。 */
export {
  ARB_LINK_MIN, DEFAULT_LOG_PADDING_MS, linkTypeLabel, groupMetaLabel,
  computeLogWindow, filterRelevantLogs,
} from "./user_log_lookup/rules.js";
export {
  parseLogData, classifyLogTitle, extractLogProvider, extractLogOrderId,
  extractLogTarget, extractLogAccountLabel, buildLogSegments, summarizeUserLog,
} from "./user_log_lookup/logs.js";
export { buildPlatformSections, buildOrderSections, sideDisplayLabel, buildLegSections } from "./user_log_lookup/sections.js";
export { toAdminOrderLogPayload, formatLookupReport, formatCnTime } from "./user_log_lookup/payload.js";
export { lookupOrderLogs } from "./user_log_lookup/query.js";

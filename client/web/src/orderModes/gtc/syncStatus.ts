/** [changmen 扩展] 查询可用性与订单事实分开；不能据此推断拒单、撤单或成交回滚。 */
export interface GtcSyncIssue { kind: "auth" | "query"; message: string; at: number }

export function legacyGtcQueryIssue(message: string): GtcSyncIssue["kind"] | undefined {
  if (/登录服务|登录会话暂|登录状态正在更新|TEMPORARY_UNAVAILABLE/.test(message)) return "auth";
  if (/GTC (?:原单尚未查到|本次原单查询未返回记录|成交分页)|查询失败|核对失败|Failed to fetch|Network Error|ECONNRESET|Connection terminated|timeout|timed out/i.test(message)) return "query";
}

export function gtcSyncIssue(error: unknown): GtcSyncIssue {
  const message = error instanceof Error ? error.message : String(error || "查询暂时不可用");
  return { kind: legacyGtcQueryIssue(message) === "auth" ? "auth" : "query", message, at: Date.now() };
}

export function gtcSyncNotice(issue: GtcSyncIssue): string {
  return issue.kind === "auth"
    ? "同步提示：登录服务暂不可用，状态同步暂停；已确认订单记录保留，恢复后自动重试。"
    : `同步提示：最近查询未成功（${issue.message}）；已确认订单记录保留，稍后自动重试。`;
}

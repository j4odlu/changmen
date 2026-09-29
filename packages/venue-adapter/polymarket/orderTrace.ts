import { saveUserLog } from "@changmen/client-core/bridge/clientApi";

type Stage = "submit" | "ack" | "watch" | "ws_event" | "ws_open" | "ws_close" | "ws_timeout" | "lookup" | "decision";
interface Details {
  submittedAt?: number;
  linkId?: number;
  receivedAt?: number;
  startedAt?: number;
  status?: string;
  outcome?: string;
  orderRead?: string;
  tradeRead?: string;
  replayed?: boolean;
}

/** [changmen 扩展] 白名单时序诊断；不接收原始响应、凭证、签名或错误正文。失败不影响下注。 */
export function tracePolymarketOrder(accountId: number | undefined, orderId: string | null, stage: Stage, details: Details = {}): void {
  const at = Date.now();
  const data: Record<string, unknown> = { diagnosticVersion: 1, provider: "Polymarket", accountId, orderId, stage, observedAt: at };
  for (const key of ["submittedAt", "linkId", "receivedAt", "startedAt"] as const) {
    const value = details[key];
    if (typeof value === "number" && Number.isFinite(value))
      data[key] = value;
  }
  for (const key of ["status", "outcome", "orderRead", "tradeRead"] as const) {
    const value = details[key];
    if (typeof value === "string" && /^[a-z_]{1,40}$/i.test(value))
      data[key] = value;
  }
  if (typeof details.replayed === "boolean")
    data.replayed = details.replayed;
  if (details.submittedAt)
    data.sinceSubmitMs = Math.max(0, at - details.submittedAt);
  if (details.startedAt)
    data.durationMs = Math.max(0, at - details.startedAt);
  void saveUserLog(`PM 原单时序 / ${stage}`, data).catch(() => {});
}

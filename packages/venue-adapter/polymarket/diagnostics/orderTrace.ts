import { saveUserLog } from "@changmen/client-core/bridge/clientApi";

type Stage = "submit" | "ack" | "watch" | "ws_event" | "ws_open" | "ws_close" | "ws_timeout" | "order_read" | "lookup" | "decision";
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
  eventType?: string;
  eventAction?: string;
  interpretation?: string;
  statusFormat?: string;
  errorCategory?: string;
  orderErrorCategory?: string;
  tradeErrorCategory?: string;
  endpoint?: string;
  upstreamStatus?: number;
  orderHttpStatus?: number;
  tradeHttpStatus?: number;
  sizeMatched?: number;
  originalSize?: number;
  associatedTradeCount?: number;
  unknownFieldCount?: number;
  messageFields?: string[];
}

/** [changmen 扩展] 只分类错误，不记录错误正文、响应体或凭证。 */
export function polymarketReadErrorDetails(error: unknown): { upstreamStatus?: number; errorCategory: string } {
  const row = error as { status?: number; response?: { status?: number }; code?: string; message?: string } | null;
  const status = Number(row?.response?.status ?? row?.status);
  const upstreamStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined;
  const message = String(row?.message ?? "");
  const errorCategory = upstreamStatus === 404 ? "not_found"
    : upstreamStatus === 401 || upstreamStatus === 403 ? "auth"
      : upstreamStatus === 429 ? "rate_limit"
        : upstreamStatus != null ? "http_error"
          : /FOK_ORDER_NOT_FILLED|couldn't be fully filled|FOK orders are (fully )?filled or killed/i.test(message) ? "fok_not_filled"
            : /not enough balance|allowance|insufficient.*balance/i.test(message) ? "balance_allowance"
              : /超时|timeout/i.test(message) || row?.code === "ECONNABORTED" ? "query_timeout"
                : /Network Error|fetch failed|ECONNRESET|ENOTFOUND/i.test(message) ? "network"
                  : /非订单|非列表|不匹配/i.test(message) ? "invalid_response" : "other";
  return { upstreamStatus, errorCategory };
}

const WS_FIELDS = new Set(["id", "event_type", "type", "status", "size_matched", "original_size", "associate_trades", "taker_order_id", "maker_orders", "error", "errorMsg", "errMsg", "message", "reason", "payload", "topic"]);

/** [changmen 扩展] 保存关联消息的结构和数量；未知/FAILED 事件也留证，不改变成交判定。 */
export function tracePolymarketWsMessage(accountId: number | undefined, orderId: string, msg: Record<string, unknown>, outcome: string | null, receivedAt: number, replayed: boolean): void {
  const status = String(msg.status ?? msg.type ?? "");
  const eventType = String(msg.event_type ?? "");
  const failed = /^(TRADE_STATUS_)?FAILED$/i.test(String(msg.status ?? ""));
  const number = (value: unknown) => value != null && String(value).trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : undefined;
  const interpretation = outcome ?? (failed ? "trade_failed"
    : !eventType && !msg.type ? "missing_event_type"
      : /CANCELLATION|CANCELED|CANCELLED/i.test(status) && number(msg.size_matched) == null ? "missing_fill_quantity"
        : /PLACEMENT|UPDATE|LIVE|UNMATCHED|DELAYED/i.test(status) ? "nonterminal" : "unrecognized");
  const error = msg.error ?? msg.errorMsg ?? msg.errMsg ?? msg.message ?? msg.reason;
  tracePolymarketOrder(accountId, orderId, "ws_event", {
    receivedAt, replayed, status, outcome: outcome ?? undefined, eventType, eventAction: String(msg.type ?? ""), interpretation,
    statusFormat: !status ? "missing" : /^[a-z_]{1,40}$/i.test(status) ? "enum" : "non_enum",
    sizeMatched: number(msg.size_matched), originalSize: number(msg.original_size),
    associatedTradeCount: Array.isArray(msg.associate_trades) ? msg.associate_trades.length : undefined,
    messageFields: Object.keys(msg).filter(key => WS_FIELDS.has(key)),
    unknownFieldCount: Object.keys(msg).filter(key => !WS_FIELDS.has(key)).length,
    errorCategory: error == null ? undefined : polymarketReadErrorDetails({ message: String(error) }).errorCategory,
  });
}

/** [changmen 扩展] 白名单时序诊断；不接收原始响应、凭证、签名或错误正文。失败不影响下注。 */
export function tracePolymarketOrder(accountId: number | undefined, orderId: string | null, stage: Stage, details: Details = {}): void {
  const at = Date.now();
  const data: Record<string, unknown> = { diagnosticVersion: 2, provider: "Polymarket", accountId, orderId, stage, observedAt: at };
  for (const key of ["submittedAt", "linkId", "receivedAt", "startedAt", "upstreamStatus", "orderHttpStatus", "tradeHttpStatus", "sizeMatched", "originalSize", "associatedTradeCount", "unknownFieldCount"] as const) {
    const value = details[key];
    if (typeof value === "number" && Number.isFinite(value))
      data[key] = value;
  }
  for (const key of ["status", "outcome", "orderRead", "tradeRead", "eventType", "eventAction", "interpretation", "statusFormat", "errorCategory", "orderErrorCategory", "tradeErrorCategory", "endpoint"] as const) {
    const value = details[key];
    if (typeof value === "string" && /^[a-z_]{1,40}$/i.test(value))
      data[key] = value;
  }
  if (typeof details.replayed === "boolean")
    data.replayed = details.replayed;
  if (Array.isArray(details.messageFields))
    data.messageFields = details.messageFields.filter(key => WS_FIELDS.has(key));
  if (details.submittedAt)
    data.sinceSubmitMs = Math.max(0, at - details.submittedAt);
  if (details.startedAt)
    data.durationMs = Math.max(0, at - details.startedAt);
  void saveUserLog(`PM 原单时序 / ${stage}`, data).catch(() => {});
}

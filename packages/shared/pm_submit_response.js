/** 重复订单错误只证明此次请求重复，不能证明原单未受理。 */
export function isPmAmbiguousOrderError(message) {
  return /\bduplicat(?:ed|e)\b|INVALID_ORDER_DUPLICATED/i.test(String(message));
}

/** [changmen 扩展] 官方明确拒绝的 JSON 回执；其它网关/超时响应保持未知。 */
export function pmSubmitRejectionFromHttp(status, data) {
  let body = data;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return null; }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const errorMsg = typeof body.error === "string" ? body.error.trim()
    : body.success === false && typeof body.errorMsg === "string" ? body.errorMsg.trim() : "";
  if (!errorMsg || body.success === true || body.orderID) return null;
  if (isPmAmbiguousOrderError(errorMsg)) return null;
  const code = Number(status);
  const disabled = code === 503 && [
    "Trading is currently disabled. Check polymarket.com for updates",
    "Trading is currently cancel-only. New orders are not accepted, but cancels are allowed.",
    "post-only mode: only post-only orders and cancels are allowed",
  ].includes(errorMsg);
  if (![400, 401, 403, 404, 422, 429].includes(code)
    && !(code === 500 && errorMsg.toLowerCase() === "order timed out") && !disabled) return null;
  return { success: false, errorMsg, pmSubmitRejected: true };
}

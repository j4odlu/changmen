import type { OrderObservationEvent } from "@changmen/shared/order_observation";

/** [changmen 扩展] 分类而非复制错误全文，避免凭证/签名出现在事实记录中。 */
export function observationFailureEvidence(message: unknown, response?: unknown, error?: unknown): Partial<OrderObservationEvent> {
  try {
    const text = typeof message === "string" ? message : "";
    const cases: Array<[RegExp, string, string]> = [
      [/timeout|timed out|超时/i, "timeout", "请求或确认超时"],
      [/network|failed to fetch|ECONN|网络|连接失败/i, "network", "网络或连接异常"],
      [/token|unauthor|forbidden|签名|凭证|登录|鉴权/i, "authentication", "鉴权、凭证或签名异常"],
      [/balance|insufficient|余额|资金不足/i, "balance", "余额或可用资金不足"],
      [/suspend|closed|盘口.*关闭|封盘|停盘/i, "market_closed", "盘口关闭或暂停"],
      [/odds|price|quote|赔率|报价/i, "quote", "报价或赔率校验异常"],
    ];
    const matched = cases.find(([pattern]) => pattern.test(text));
    const fields: Partial<OrderObservationEvent> = { errorCategory: matched?.[1] || "unclassified", safeSummary: matched?.[2] || "执行失败，具体原因尚未分类" };
    if (response && typeof response === "object") {
      const code = (response as Record<string, unknown>).code;
      if ((typeof code === "number" && Number.isSafeInteger(code)) || (typeof code === "string" && /^(?:-?\d{1,10}|[A-Z][A-Z0-9_]{0,47})$/.test(code)))
        fields.responseCode = String(code);
    }
    if (error && typeof error === "object" && (error as { isAxiosError?: boolean }).isAxiosError) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (Number.isInteger(status) && status! >= 100 && status! <= 599)
        fields.httpStatus = status;
    }
    return fields;
  }
  catch { return {}; }
}

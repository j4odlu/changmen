import type { OrderObservationEvent } from "@changmen/shared/order_observation";

type FailureReason = [category: string, code: string, summary: string];
const DIAGNOSTIC_NUMBER = "(\\d{1,8}(?:\\.\\d{1,8})?)(?![\\d.])";
function diagnosticNumber(text: string, prefix: string, suffix = "") {
  return new RegExp(`${prefix}${DIAGNOSTIC_NUMBER}${suffix}`).exec(text)?.[1];
}
/** [changmen 扩展] RAY desc 是场馆错误说明，仅允许简短人类文本进入观察记录。 */
function rayFailureDescription(response: unknown): { text?: string; supplied: boolean } {
  if (!response || typeof response !== "object") return { supplied: false };
  const desc = (response as Record<string, unknown>).desc;
  if (desc == null || desc === "") return { supplied: false };
  if (typeof desc !== "string") return { supplied: true };
  const text = desc.trim();
  if (!text) return { supplied: false };
  // 不接收 URL、HTML、JSON、凭证字段、邮箱、长 ID 或整段请求/响应。
  if (text.length > 120
    || !/^[\p{L}\p{N}\s.,，。:：;；!！?？()（）\-+%％'"、]+$/u.test(text)
    || /token|secret|signature|authorization|password|private.?key|api.?key|cookie|gateway|凭证|私钥|密码|签名|钱包地址|账号\s*[:：]|账户\s*[:：]|https?|[A-Za-z0-9]{24,}|\d{9,}/i.test(text))
    return { supplied: true };
  return { supplied: true, text: text.replace(/\s+/g, " ") };
}
/** [changmen 扩展] 只保留已知原因和白名单数值，不复制错误全文、资产 ID 或凭证。 */
function specificFailure(text: string, headline: string): FailureReason | undefined {
  if (/盘口无卖单|无 asks 卖单|no asks|no sell orders/i.test(headline)
    || /盘口价高于检测价/.test(headline) && /盘口无卖单/.test(text))
    return ["liquidity", "no_sell_orders", "盘口没有可成交卖单"];
  if (/盘口价高于检测价/.test(headline)) {
    const ask = diagnosticNumber(text, "最佳卖价\\s+");
    const cap = diagnosticNumber(text, "高于检测价\\s+");
    return ["quote", "price_above_detection", `当前卖价高于检测限价，已阻止提交${ask && cap ? `（卖价 ${ask}，限价 ${cap}）` : ""}`];
  }
  if (/无效检测价/.test(headline)) {
    const price = diagnosticNumber(headline, "无效检测价\\s+");
    return ["quote", "invalid_detection_price", `检测价格无效，无法校验订单${price ? `（价格 ${price}）` : ""}`];
  }
  if (/盘口深度不足|insufficient liquidity|insufficient depth/i.test(headline)) {
    const need = diagnosticNumber(text, "需要\\s+", "\\s+USDC");
    const available = diagnosticNumber(text, "可立即成交(?:约|：|:)?\\s*", "\\s+USDC");
    return ["liquidity", "insufficient_depth", `限价内可成交深度不足，无法整笔成交${available ? `（可成交 ${available} USDC${need ? `，需要 ${need} USDC` : ""}）` : ""}`];
  }
  if (/下单金额低于最小份数|minimum order size|min order size/i.test(headline)) {
    const shares = diagnosticNumber(text, "预计买入：\\s*", "\\s*份");
    const minimum = diagnosticNumber(text, "最小下单份数：\\s*");
    return ["order_size", "below_minimum_size", `买入份数低于场馆最小要求${minimum ? `（${shares ? `预计 ${shares} 份，` : ""}至少 ${minimum} 份）` : ""}`];
  }
  const rules: Array<[RegExp, FailureReason]> = [
    [/^RAY 盘口请求失败$/, ["market_data", "market_request_failed", "RAY 盘口接口返回失败，无法准备订单"]],
    [/无效买入金额/i, ["order_size", "invalid_amount", "买入金额无效，必须为大于零的有效金额"]],
    [/无盘口数据/i, ["market_data", "no_market_data", "未获取到可用盘口数据，无法准备订单"]],
    [/没有可用账号/i, ["account", "no_account", "当前场馆没有可用的下单账号"]],
    [/不被支持/i, ["provider", "unsupported_provider", "当前场馆不支持下单预检"]],
    [/缺少有效私钥|钱包.*解锁|解锁.*钱包/i, ["authentication", "wallet_key_unavailable", "本机钱包未解锁或没有匹配的有效私钥，请解锁或重新导入"]],
    [/凭证缺少.*API Key/i, ["authentication", "missing_api_credentials", "缺少场馆 API 凭证，请重新通过插件采集"]],
    [/凭证缺少 walletAddress/i, ["authentication", "missing_wallet_address", "账号凭证缺少钱包地址，请检查账号设置"]],
    [/suspend|closed|盘口.*关闭|封盘|停盘/i, ["market_closed", "market_closed", "盘口已关闭或暂停，暂不可下单"]],
    [/赔率.*(?:降低|下降|变化|不在|不符合)|(?:降低|下降).*赔率/i, ["quote", "odds_changed", "当前赔率发生变化或不满足策略要求，已阻止提交"]],
  ];
  return rules.find(([pattern]) => pattern.test(headline))?.[1];
}

/** [changmen 扩展] 明确原因优先；未知错误仍只分类，防止敏感信息进入事实记录。 */
export function observationFailureEvidence(message: unknown, response?: unknown, error?: unknown, provider?: string): Partial<OrderObservationEvent> {
  try {
    const text = typeof message === "string" ? message : "";
    const rayDescription = provider === "RAY" ? rayFailureDescription(response) : undefined;
    // 诊断段可能包含“赔率、tokenId”等字段，不能反过来改变主错误的分类。
    const headline = text.split(/\r?\n/).find(line => line.trim()) || "";
    const classificationHeadline = rayDescription?.text || headline;
    const specific = specificFailure(rayDescription?.text || text, classificationHeadline);
    const cases: Array<[RegExp, string, string]> = [
      [/timeout|timed out|超时/i, "timeout", "请求或确认超时"],
      [/network|failed to fetch|ECONN|网络|连接失败/i, "network", "网络或连接异常"],
      // [changmen 扩展] PM 的 tokenId / tokens 是交易资产，不是鉴权 token。
      [/\btoken(?:[_-](?:error|expired|invalid|missing))?\b|\b(?:access|auth|refresh)[_-]?token\b|unauthor|forbidden|签名|凭证|私钥|钱包.*解锁|解锁.*钱包|登录|鉴权/i, "authentication", "鉴权、凭证或签名异常"],
      [/盘口深度不足|无 asks 卖单|盘口无卖单|insufficient liquidity|insufficient depth/i, "liquidity", "盘口深度不足或无可成交卖单"],
      [/下单金额低于最小份数|无效买入金额|minimum order size|min order size/i, "order_size", "下单金额或份数不满足要求"],
      [/balance|insufficient|余额|资金不足/i, "balance", "余额或可用资金不足"],
      [/suspend|closed|盘口.*关闭|封盘|停盘/i, "market_closed", "盘口关闭或暂停"],
      [/odds|price|quote|赔率|报价/i, "quote", "报价或赔率校验异常"],
    ];
    const matched = cases.find(([pattern]) => pattern.test(classificationHeadline));
    const fields: Partial<OrderObservationEvent> = { errorCategory: specific?.[0] || matched?.[1] || "unclassified",
      safeSummary: specific?.[2] || matched?.[2] || "执行失败，未记录可识别的具体原因",
      ...(specific ? { reasonCode: specific[1] } : {}) };
    if (response && typeof response === "object") {
      const code = (response as Record<string, unknown>).code;
      if ((typeof code === "number" && Number.isSafeInteger(code)) || (typeof code === "string" && /^(?:-?\d{1,10}|[A-Z][A-Z0-9_]{0,47})$/.test(code)))
        fields.responseCode = String(code);
    }
    if (rayDescription && fields.responseCode && fields.responseCode !== "200") {
      fields.safeSummary = rayDescription.text
        ? `RAY 场馆返回：${rayDescription.text}`
        : `RAY 返回业务码 ${fields.responseCode}，${rayDescription.supplied ? "错误说明无法安全展示" : "未提供错误说明"}`;
      fields.reasonCode ??= "venue_response_failed";
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

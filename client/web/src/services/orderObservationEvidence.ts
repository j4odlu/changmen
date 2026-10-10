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
/** [changmen 扩展] 拒单 comment 沿用场馆说明白名单，不依赖 POST 的业务码。 */
export function rayRejectFailureEvidence(reason: unknown): Partial<OrderObservationEvent> {
  const description = rayFailureDescription({ desc: reason });
  return { reasonCode: "venue_rejected", errorCategory: "venue_reject", safeSummary: description.text
    ? `RAY 拒单原因：${description.text}` : "RAY 已拒单，未记录可安全展示的场馆说明" };
}
/** [changmen 扩展] 只保留已知原因和白名单数值，不复制错误全文、资产 ID 或凭证。 */
function specificFailure(text: string, headline: string): FailureReason | undefined {
  if (/^超时时间：\d+ms，大于设定值：\d+ms$/.test(headline)) {
    const elapsed = diagnosticNumber(headline, "超时时间：", "ms");
    const limit = diagnosticNumber(headline, "大于设定值：", "ms");
    return ["timeout", "precheck_timeout", `双腿预检总耗时超过设定上限，未提交${elapsed && limit ? `（耗时 ${elapsed}ms，上限 ${limit}ms）` : ""}`];
  }
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
  // [changmen 扩展] GTC 自动双腿预检使用独立文案，保留整对未提交的事实。
  if (/^GTC 自动套利限价内深度不足，未发送双腿$/.test(headline.trim()))
    return ["liquidity", "insufficient_depth", "限价内可成交深度不足，未发送双腿"];
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
    [/^GTC 签单舍入与含费预算后利润不足：/, ["profit", "gtc_profit_below_threshold", "GTC 签单舍入及费用计入后利润不足，未发送双腿"]],
    [/^GTC 签单本金与份数舍入后利润不足：/, ["profit", "gtc_profit_below_threshold", "GTC 签单本金与份数舍入后利润不足，未发送双腿"]],
    [/^GTC 无法确认市场费率或不支持当前费用曲线$/, ["market_data", "gtc_fee_unavailable", "GTC 市场费率未确认或费用曲线不受支持，无法准备签单"]],
    [/^GTC 含费用预算不足最小份数$/, ["order_size", "gtc_below_minimum_size", "GTC 扣除费用预留后买入份数不足场馆最小要求"]],
    [/^GTC 实际签单数量或预算越界$/, ["order_size", "gtc_signed_budget_exceeded", "GTC 实际签单数量或含费预算超出允许范围"]],
    [/^GTC SDK 未生成受支持签单$/, ["signing", "gtc_signed_order_invalid", "GTC SDK 未生成受支持的签单"]],
    [/^GTC 数值无效$/, ["order_size", "gtc_invalid_value", "GTC 数量或预算数值无效"]],
    [/^GTC 预检金额单位与场馆原币不一致，禁止发送双腿$/, ["order_size", "gtc_currency_mismatch", "GTC 预检金额单位与场馆原币不一致，未发送双腿"]],
    [/^GTC 已达同场同边盘口订单上限$/, ["account", "gtc_order_limit", "GTC 已达同场同边盘口订单上限"]],
    [/^GTC 赔率不大于上笔成功单$/, ["quote", "gtc_previous_odds_limit", "GTC 当前赔率不高于上笔成功单，不满足账号要求"]],
    [/^GTC 同场反向下注账号已排除$/, ["account", "gtc_opposite_account_excluded", "GTC 账号已有同场反向下注，不满足账号要求"]],
    [/^(?:此 PM 钱包有待处理 GTC，请先核实原单|此 PM 钱包已有 GTC 未完结记录，请先核实原单并恢复自动下注)$/, ["account", "gtc_pending_original", "PM 钱包存在未完结 GTC 原单，暂停新增自动套利"]],
    [/^GTC 持久化协调未就绪$/, ["persistence", "gtc_persistence_unready", "GTC 持久化协调尚未就绪，禁止提交"]],
    [/^GTC 本盘口成交历史恢复失败$/, ["persistence", "gtc_bet_history_unavailable", "GTC 本盘口成交历史未能恢复，无法核验用户启用的历史限制"]],
    [/^GTC V1 仅支持一条 PM 腿的双边自动套利$/, ["provider", "gtc_pair_unsupported", "GTC 自动套利要求恰有一条 PM 腿及一条对侧下单腿"]],
    [/^GTC 对侧平台不支持$/, ["provider", "gtc_counterpart_unsupported", "GTC 对侧平台不支持提交"]],
    [/^GTC 对侧(?:冻结预检或账号已改变|缺少冻结预检，未发送订单)$/, ["preparation", "gtc_counterpart_changed", "GTC 对侧冻结预检缺失或账号参数已改变"]],
    [/^PM 手动 GTC 预检已失效或已消费，禁止重发$/, ["preparation", "gtc_preparation_invalid", "GTC 预检已失效或已消费，禁止重复提交"]],
    [/^PM 手动 GTC 每次预检须新建投注尝试$/, ["preparation", "gtc_attempt_reused", "GTC 投注尝试已被使用，请新建尝试"]],
    [/^PM 手动 GTC 冻结报价已改变$/, ["quote", "gtc_frozen_quote_changed", "GTC 冻结报价在预检后发生变化，请新建尝试"]],
    [/^PM 手动 GTC 金额不足，不能放大用户输入金额$/, ["order_size", "gtc_amount_insufficient", "GTC 输入金额不足，无法按原金额准备订单"]],
    [/^PM 手动 GTC 预检未完成$/, ["preparation", "gtc_precheck_incomplete", "GTC 预检未完成，无法准备订单"]],
    [/^PM 手动 GTC 限价或订单簿无效$/, ["market_data", "gtc_book_invalid", "GTC 限价或订单簿无效，无法准备订单"]],
    [/^PM 手动 GTC 预检参数或钱包会话已失效$/, ["preparation", "gtc_binding_invalid", "GTC 预检参数或钱包会话已失效，请新建尝试"]],
    [/^PM 钱包或 API 凭据未就绪$/, ["authentication", "pm_credentials_unready", "PM 钱包或 API 凭据未就绪"]],
    [/^PM 预检期间钱包凭据已改变$/, ["authentication", "pm_credentials_changed", "PM 钱包凭据在预检期间发生变化，请新建尝试"]],
    [/^PM 缺少本轮预检结果$/, ["preparation", "pm_preparation_missing", "PM 缺少本轮有效预检结果"]],
    [/^PM 本轮预检结果已消费$/, ["preparation", "pm_preparation_consumed", "PM 本轮预检结果已消费，禁止重复提交"]],
    [/^PM 此腿仅预检$/, ["preparation", "pm_precheck_only", "PM 此腿仅预检，不允许真实提交"]],
    [/^PM 提交校时(?:准备已失效|未就绪)$/, ["preparation", "pm_submit_clock_invalid", "PM 提交校时准备未就绪或已失效"]],
    [/^PM 钱包会话已失效$/, ["authentication", "pm_wallet_session_invalid", "PM 钱包会话已失效，请重新解锁后新建尝试"]],
    [/^PM 下单参数或账号已改变，请新建尝试$/, ["preparation", "pm_preparation_changed", "PM 下单参数或账号在预检后发生变化，请新建尝试"]],
    [/^PM tick 已改变/, ["quote", "pm_tick_changed", "PM 最小价格步长已改变，冻结报价失效，请新建尝试"]],
    [/^双侧预检未齐，不提交订单$/, ["preparation", "pair_quote_missing", "双腿提交前缺少完整预检结果，未发送双腿"]],
    [/^首腿提交返回失败，未发送第二腿$/, ["orchestration", "serial_first_leg_failed", "首腿提交返回失败，未发送第二腿"]],
    [/^首腿提交结果未知，未发送第二腿$/, ["orchestration", "serial_first_leg_unknown", "首腿提交结果未知，未发送第二腿"]],
    [/^自动下注或用户会话已停止$|^GTC 会话已变更$/, ["session", "execution_session_stopped", "自动下注已停止或用户会话已变更"]],
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

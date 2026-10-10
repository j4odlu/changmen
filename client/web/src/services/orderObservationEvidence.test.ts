import { describe, expect, it } from "vitest";
import { observationFailureEvidence } from "./orderObservationEvidence";

describe("旁路失败证据", () => {
  it("retains an unrecognized human RAY rejection description instead of replacing it with a generic error", () => {
    const evidence = observationFailureEvidence("投注操作失败，请稍后重试", { code: 500, desc: "投注操作失败，请稍后重试" }, undefined, "RAY");
    expect(evidence.safeSummary).toBe("RAY 场馆返回：投注操作失败，请稍后重试");
    expect(evidence.responseCode).toBe("500");
    expect(evidence.reasonCode).toBe("venue_response_failed");
    expect(evidence.httpStatus).toBeUndefined();
  });
  it("explicitly reports when RAY supplies no error description", () => {
    expect(observationFailureEvidence("", { code: 500 }, undefined, "RAY").safeSummary)
      .toBe("RAY 返回业务码 500，未提供错误说明");
  });
  it("classifies the actual RAY description while retaining its detail", () => {
    const evidence = observationFailureEvidence("RAY 盘口请求失败", { code: 500, desc: "余额不足，请充值后重试" }, undefined, "RAY");
    expect(evidence.errorCategory).toBe("balance");
    expect(evidence.safeSummary).toBe("RAY 场馆返回：余额不足，请充值后重试");
  });
  it.each([
    "token=SECRET", "账号：nipaztec", "密码 SECRET", "https://venue.example/auth", "<html>SECRET</html>",
    "错误 ABCDEFGHIJKLMNOPQRSTUVWXYZ", "错误 123456789012345", { token: "SECRET" },
  ])("does not copy sensitive or structured RAY descriptions: %s", (desc) => {
    const evidence = observationFailureEvidence("", { code: 500, desc }, undefined, "RAY");
    expect(evidence.safeSummary).toBe("RAY 返回业务码 500，错误说明无法安全展示");
    expect(JSON.stringify(evidence)).not.toContain("SECRET");
  });
  it("explains the price limit using safe numeric values, without copying diagnostic credentials", () => {
    const evidence = observationFailureEvidence("Polymarket 盘口价高于检测价，整单取消\n- 最佳卖价 0.46（赔率 2.1739）高于检测价 0.4444（赔率 2.25）\n- tokenId：123456789\n- privateKey=SECRET signature=PRIVATE");
    expect(evidence.reasonCode).toBe("price_above_detection");
    expect(evidence.safeSummary).toBe("当前卖价高于检测限价，已阻止提交（卖价 0.46，限价 0.4444）");
    expect(JSON.stringify(evidence)).not.toMatch(/SECRET|PRIVATE|123456789|tokenId|signature/);
  });
  it("distinguishes an empty order book from price-above-limit", () => {
    const evidence = observationFailureEvidence("Polymarket 盘口价高于检测价，整单取消\n- 最佳卖价：无\n- 盘口无卖单\n- 页面赔率：2.25");
    expect(evidence.reasonCode).toBe("no_sell_orders");
    expect(evidence.safeSummary).toBe("盘口没有可成交卖单");
  });
  it("distinguishes RAY request failure and odds decline from missing market data", () => {
    const failure = observationFailureEvidence("RAY 盘口请求失败", { code: 401, desc: "token=SECRET" });
    expect(failure.reasonCode).toBe("market_request_failed");
    expect(failure.responseCode).toBe("401");
    expect(failure.safeSummary).toContain("盘口接口返回失败");
    expect(JSON.stringify(failure)).not.toContain("SECRET");
    const decline = observationFailureEvidence("RAY 赔率下降：检测赔率 1.65，当前赔率 1.6，超过允许差值 0.01");
    expect(decline.reasonCode).toBe("odds_changed");
  });
  it("explains depth and minimum size with whitelisted numeric diagnostics", () => {
    expect(observationFailureEvidence("Polymarket FOK 盘口深度不足\n- 需要 20.00 USDC（金额 10.00 × 2）\n- 成交价 0.44 及更优可立即成交约 8.50 USDC").safeSummary)
      .toContain("可成交 8.50 USDC，需要 20.00 USDC");
    expect(observationFailureEvidence("Polymarket 下单金额低于最小份数\n- 预计买入：3.5000 份\n- 最小下单份数：5").safeSummary)
      .toContain("预计 3.5000 份，至少 5 份");
  });
  it("identifies automatic GTC depth rejection without copying diagnostic credentials", () => {
    const evidence = observationFailureEvidence("GTC 自动套利限价内深度不足，未发送双腿\n- tokenId：123456789\n- privateKey=SECRET signature=PRIVATE");
    expect(evidence).toMatchObject({ errorCategory: "liquidity", reasonCode: "insufficient_depth",
      safeSummary: "限价内可成交深度不足，未发送双腿" });
    expect(JSON.stringify(evidence)).not.toMatch(/SECRET|PRIVATE|123456789|tokenId|signature/);
  });
  it.each([
    ["GTC 签单舍入与含费预算后利润不足：1.020940", "gtc_profit_below_threshold"],
    ["GTC 签单本金与份数舍入后利润不足：1.020940", "gtc_profit_below_threshold"],
    ["GTC 无法确认市场费率或不支持当前费用曲线", "gtc_fee_unavailable"],
    ["GTC 含费用预算不足最小份数", "gtc_below_minimum_size"],
    ["GTC 下单金额低于最小份数", "below_minimum_size"],
    ["GTC 实际签单数量或预算越界", "gtc_signed_budget_exceeded"],
    ["GTC SDK 未生成受支持签单", "gtc_signed_order_invalid"],
    ["GTC 数值无效", "gtc_invalid_value"],
    ["GTC 预检金额单位与场馆原币不一致，禁止发送双腿", "gtc_currency_mismatch"],
    ["GTC 已达同场同边盘口订单上限", "gtc_order_limit"],
    ["GTC 赔率不大于上笔成功单", "gtc_previous_odds_limit"],
    ["GTC 同场反向下注账号已排除", "gtc_opposite_account_excluded"],
    ["此 PM 钱包有待处理 GTC，请先核实原单", "gtc_pending_original"],
    ["此 PM 钱包已有 GTC 未完结记录，请先核实原单并恢复自动下注", "gtc_pending_original"],
    ["GTC 持久化协调未就绪", "gtc_persistence_unready"],
    ["GTC 本盘口成交历史恢复失败", "gtc_bet_history_unavailable"],
    ["GTC V1 仅支持一条 PM 腿的双边自动套利", "gtc_pair_unsupported"],
    ["GTC 对侧平台不支持", "gtc_counterpart_unsupported"],
    ["GTC 对侧冻结预检或账号已改变", "gtc_counterpart_changed"],
    ["GTC 对侧缺少冻结预检，未发送订单", "gtc_counterpart_changed"],
    ["PM 手动 GTC 预检已失效或已消费，禁止重发", "gtc_preparation_invalid"],
    ["PM 手动 GTC 每次预检须新建投注尝试", "gtc_attempt_reused"],
    ["PM 手动 GTC 冻结报价已改变", "gtc_frozen_quote_changed"],
    ["PM 手动 GTC 金额不足，不能放大用户输入金额", "gtc_amount_insufficient"],
    ["PM 手动 GTC 预检未完成", "gtc_precheck_incomplete"],
    ["PM 手动 GTC 限价或订单簿无效", "gtc_book_invalid"],
    ["PM 手动 GTC 预检参数或钱包会话已失效", "gtc_binding_invalid"],
    ["PM 钱包或 API 凭据未就绪", "pm_credentials_unready"],
    ["PM 预检期间钱包凭据已改变", "pm_credentials_changed"],
    ["PM 缺少本轮预检结果", "pm_preparation_missing"],
    ["PM 本轮预检结果已消费", "pm_preparation_consumed"],
    ["PM 此腿仅预检", "pm_precheck_only"],
    ["PM 提交校时准备已失效", "pm_submit_clock_invalid"],
    ["PM 提交校时未就绪", "pm_submit_clock_invalid"],
    ["PM 钱包会话已失效", "pm_wallet_session_invalid"],
    ["PM 下单参数或账号已改变，请新建尝试", "pm_preparation_changed"],
    ["PM tick 已改变，冻结限价不再有效", "pm_tick_changed"],
    ["双侧预检未齐，不提交订单", "pair_quote_missing"],
    ["首腿提交返回失败，未发送第二腿", "serial_first_leg_failed"],
    ["首腿提交结果未知，未发送第二腿", "serial_first_leg_unknown"],
    ["自动下注或用户会话已停止", "execution_session_stopped"],
    ["GTC 会话已变更", "execution_session_stopped"],
    ["超时时间：3100ms，大于设定值：3000ms", "precheck_timeout"],
  ])("records the post-precheck gate cause: %s", (message, reasonCode) => {
    const evidence = observationFailureEvidence(`${message}\nprivateKey=SECRET signature=PRIVATE`);
    expect(evidence.reasonCode).toBe(reasonCode);
    expect(evidence.errorCategory).not.toBe("unclassified");
    expect(evidence.safeSummary).not.toContain("未记录可识别");
    expect(JSON.stringify(evidence)).not.toMatch(/SECRET|PRIVATE|privateKey|signature/);
  });
  it.each([
    ["无效检测价 0（赔率 2）", "invalid_detection_price", "检测价格无效"],
    ["无效买入金额 -1", "invalid_amount", "买入金额无效"],
    ["无盘口数据", "no_market_data", "未获取到可用盘口数据"],
    ["盘口已封盘", "market_closed", "盘口已关闭或暂停"],
    ["缺少有效私钥：请先解锁本机钱包", "wallet_key_unavailable", "本机钱包未解锁"],
  ])("reports the specific cause of %s", (message, reason, summary) => {
    const evidence = observationFailureEvidence(message);
    expect(evidence.reasonCode).toBe(reason);
    expect(evidence.safeSummary).toContain(summary);
  });
  it("diagnostic odds fields do not misclassify an unknown primary error", () => {
    const evidence = observationFailureEvidence("Unexpected upstream failure\n【盘口】\n- 页面赔率：2.25\n- tokenId：123456789");
    expect(evidence.errorCategory).toBe("unclassified");
    expect(evidence.safeSummary).not.toContain("赔率校验");
  });
  it("rejects oversized numeric strings and does not copy arbitrary text", () => {
    const evidence = observationFailureEvidence("Polymarket 盘口价高于检测价\n- 最佳卖价 12345678901234567890 高于检测价 SECRET");
    expect(evidence.safeSummary).toBe("当前卖价高于检测限价，已阻止提交");
  });
  it("classifies without copying credentials or raw responses", () => {
    const evidence = observationFailureEvidence("token=SECRET signature=PRIVATE", { code: "AUTH_FAILED", token: "SECRET" });
    expect(evidence.errorCategory).toBe("authentication");
    expect(evidence.responseCode).toBe("AUTH_FAILED");
    expect(JSON.stringify(evidence)).not.toMatch(/SECRET|PRIVATE|signature/);
  });
  it.each([
    ["Polymarket 盘口价高于检测价，整单取消", "quote"],
    ["Polymarket FOK 盘口深度不足", "liquidity"],
    ["Polymarket 下单金额低于最小份数", "order_size"],
  ])("classifies PM failure %s despite asset tokenId in diagnostic details", (message, category) => {
    const evidence = observationFailureEvidence(`${message}\n【订单】\n- tokenId：123456789\n- 页面赔率：2.6399\n【盘口】\n- 最小下单份数：5`);
    expect(evidence.errorCategory).toBe(category);
    expect(JSON.stringify(evidence)).not.toContain("123456789");
  });
  it("does not classify asset tokens or token mismatch as authentication", () => {
    expect(observationFailureEvidence("tokenId=123 token_mismatch tokens=5").errorCategory).toBe("unclassified");
  });
  it.each(["token expired", "TOKEN_ERROR", "TOKEN_INVALID", "accessToken expired", "auth_token invalid", "refresh-token invalid", "凭证缺少用户 API Key", "缺少有效私钥：请先解锁本机钱包"])("still classifies credential failure %s", (message) => {
    expect(observationFailureEvidence(message).errorCategory).toBe("authentication");
  });
  it("only records actual Axios HTTP status, not venue business status", () => {
    expect(observationFailureEvidence("network", { status: 503 }).httpStatus).toBeUndefined();
    expect(observationFailureEvidence("network", undefined, { isAxiosError: true, response: { status: 503 } }).httpStatus).toBe(503);
    expect(observationFailureEvidence("network", undefined, { isAxiosError: true, response: { status: 999 } }).httpStatus).toBeUndefined();
  });
  it("rejects response codes containing arbitrary text and tolerates unreadable responses", () => {
    expect(observationFailureEvidence("timeout", { code: "SECRET token=abc" }).responseCode).toBeUndefined();
    expect(observationFailureEvidence("timeout", { get code() { throw new Error("bad getter"); } })).toEqual({});
  });
});

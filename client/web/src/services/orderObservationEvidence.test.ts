import { describe, expect, it } from "vitest";
import { observationFailureEvidence } from "./orderObservationEvidence";

describe("旁路失败证据", () => {
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
  it("explains depth and minimum size with whitelisted numeric diagnostics", () => {
    expect(observationFailureEvidence("Polymarket FOK 盘口深度不足\n- 需要 20.00 USDC（金额 10.00 × 2）\n- 成交价 0.44 及更优可立即成交约 8.50 USDC").safeSummary)
      .toContain("可成交 8.50 USDC，需要 20.00 USDC");
    expect(observationFailureEvidence("Polymarket 下单金额低于最小份数\n- 预计买入：3.5000 份\n- 最小下单份数：5").safeSummary)
      .toContain("预计 3.5000 份，至少 5 份");
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

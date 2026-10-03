import { describe, expect, it } from "vitest";
import { observationFailureEvidence } from "./orderObservationEvidence";

describe("旁路失败证据", () => {
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

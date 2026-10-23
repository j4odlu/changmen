import { describe, expect, it } from "vitest";
import { reactive } from "vue";
import { BetResult } from "@changmen/client-core/models/betResult";
import { PlatformAccount } from "@/models/platformAccount";
import { applyPmBalanceRejection, pmBalanceRevision } from "./pmBalanceRejection";

function balanceReject(message = "not enough balance / allowance: the balance is not enough -> balance: 22300936, order amount: 27377400") {
  return new BetResult("Polymarket", false, message, undefined, { success: false, pmSubmitRejected: true, errorMsg: message });
}

describe("PM 明确余额拒单", () => {
  it("立即用场馆余额替换旧值，原币与人民币金额各自保持正确", () => {
    const account = new PlatformAccount({ provider: "Polymarket", currency: "USDT" }); account.balance = 50;
    const proxy = reactive(account);
    expect(applyPmBalanceRejection(proxy, balanceReject())).toBe(true);
    expect(account.balance).toBe(22.300936);
    expect(account.getBalance()).toBeLessThan(177.483);
    expect(account.getBalance()).toBeGreaterThan(100);
    expect(pmBalanceRevision(account)).toBe(pmBalanceRevision(proxy));
  });
  it("只有明确余额不足但不含数值时清除未知余额，不捏造为零", () => {
    const account = new PlatformAccount({ provider: "Polymarket" }); account.balance = 50;
    expect(applyPmBalanceRejection(account, balanceReject("insufficient balance"))).toBe(true);
    expect(account.balance).toBeUndefined();
  });
  it.each(["not enough balance / allowance", "insufficient allowance", "network error", "FOK order not filled"])("%s 不误改余额", message => {
    const account = new PlatformAccount({ provider: "Polymarket" }); account.balance = 50;
    expect(applyPmBalanceRejection(account, balanceReject(message))).toBe(false);
    expect(account.balance).toBe(50);
  });
  it.each(["accepted", "pending", "unknown", "other", "not-posted"])("%s 不能据此改余额", kind => {
    const account = new PlatformAccount({ provider: kind === "other" ? "OB" : "Polymarket" }); account.balance = 50;
    const result = balanceReject();
    if (kind === "accepted") result.success = true;
    if (kind === "pending") result.pending = true;
    if (kind === "unknown") result.pmSubmitUnknown = true;
    if (kind === "not-posted") (result.response as Record<string, unknown>).pmSubmitRejected = false;
    expect(applyPmBalanceRejection(account, result)).toBe(false);
    expect(account.balance).toBe(50);
  });
});

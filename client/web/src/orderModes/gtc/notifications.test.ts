import type { BetResult } from "@changmen/client-core/models/betResult";
import type { GtcExecutionResult } from "./executionResult";
import { describe, expect, it } from "vitest";
import { gtcOtherNotice, gtcPmNotice } from "./notifications";

// GTC only projects its result; rendering and timing are shared by every order mode.
describe("GTC result text and severity", () => {
  it.each([
    ["accepted", "none", "warning"], ["accepted", "partial", "warning"],
    ["accepted", "unknown", "warning"], ["accepted", "full", "success"],
    ["unknown", "unknown", "warning"], ["rejected", "none", "error"],
  ])("PM %s/%s uses %s without claiming unconfirmed fills", (submission, fill, type) => {
    expect(gtcPmNotice({ pm: { submission, fill }, message: "状态" } as GtcExecutionResult).type).toBe(type);
  });
  it.each([
    [{ success: true, pending: false }, "success"],
    [{ success: true, pending: true }, "warning"],
    [{ success: false, response: { code: 400 } }, "error"],
    [{ success: false }, "warning"],
    [{ success: false, pmSubmitUnknown: true, response: {} }, "warning"],
  ])("counterpart result %j uses %s", (result, type) => {
    expect(gtcOtherNotice(result as BetResult).type).toBe(type);
  });
});

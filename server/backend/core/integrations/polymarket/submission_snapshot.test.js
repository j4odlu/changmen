import { describe, expect, it } from "vitest";
import { recoverPmSubmissionFromLogs } from "./submission_snapshot.js";
import { pmMakerAmountUsdc, validatePmSubmission } from "@changmen/shared/pm_submission";

const id = `0x${"9".repeat(64)}`;
const player = { id: 317, playerName: "a-tongmu" };
function row(overrides = {}) {
  return { title: "[Polymarket](PM,a-tongmu) 下注 => true", data: JSON.stringify({
    result: { provider: "Polymarket", orderId: id, beginTime: 1790697330729,
      request: { order: { side: "BUY", makerAmount: "14930000", signature: "never-return" } },
      ...overrides },
  }) };
}
describe("recover original PM submission", () => {
  it("recovers legacy logs and only returns safe accounting fields", () => {
    const recovered = recoverPmSubmissionFromLogs([row()], player, id);
    expect(recovered).toEqual({ orderId: id, accountId: 317, stakeUsdc: 14.93,
      makerAmount: "14930000", submittedAt: 1790697330729 });
    expect(validatePmSubmission(recovered, id, 317)).toEqual(recovered);
  });
  it("rejects wrong account, order, SELL, contradictory amounts and malformed logs", () => {
    expect(recoverPmSubmissionFromLogs([row()], { ...player, playerName: "other" }, id)).toBeNull();
    expect(recoverPmSubmissionFromLogs([row({ orderId: "other" })], player, id)).toBeNull();
    expect(recoverPmSubmissionFromLogs([row({ request: { order: { side: "SELL", makerAmount: "14930000" } } })], player, id)).toBeNull();
    expect(recoverPmSubmissionFromLogs([row(), row({ request: { order: { side: "BUY", makerAmount: "118000000" } } })], player, id)).toBeNull();
    expect(recoverPmSubmissionFromLogs([{ title: "", data: "broken" }], player, id)).toBeNull();
  });
  it("explicit account ID takes priority over display names", () => {
    const data = JSON.parse(row().data);
    data.accountId = 1;
    expect(recoverPmSubmissionFromLogs([{ ...row(), data }], player, id)).toBeNull();
  });
  it("always interprets integer makerAmount as micro USDC", () => {
    expect(pmMakerAmountUsdc("500")).toBe(0.0005);
    expect(pmMakerAmountUsdc("14930000")).toBe(14.93);
    for (const value of ["14.93", "NaN", "-1", "0", "9007199254740992"])
      expect(pmMakerAmountUsdc(value)).toBeNull();
  });

  it("preserves the public original maker for legacy wallet binding and rejects contradictions", () => {
    const withMaker = maker => row({ request: { order: { side: "BUY", makerAmount: "14930000", maker, signature: "never-return" } } });
    const maker = "0x1111111111111111111111111111111111111111";
    const snapshot = recoverPmSubmissionFromLogs([withMaker(maker), row()], player, id);
    expect(snapshot.makerAddress).toBe(maker);
    expect(validatePmSubmission(snapshot, id, 317)).toEqual(snapshot);
    expect(JSON.stringify(snapshot)).not.toContain("never-return");
    expect(recoverPmSubmissionFromLogs([withMaker(maker), withMaker("0x2222222222222222222222222222222222222222")], player, id)).toBeNull();
  });
});

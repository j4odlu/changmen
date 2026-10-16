import fs from "node:fs";
import { expect, it } from "vitest";
import { restorePmFokCancellationSource, verifyPmFokCancellationContract } from "./pm-fok-cancellation-boundary.mjs";
const read = file => fs.readFileSync(file, "utf8");
it("accepts only the precise authorized cancellation changes", () => {
  expect(() => verifyPmFokCancellationContract(read)).not.toThrow();
});
it.each([
  ["realtime/userWs.ts", 'entry.submittedOrderType === "FOK"', 'true'],
  ["realtime/fokCancellation.ts", 'hasFillEvidence || hasTradeIds', 'false'],
  ["fok/bet.ts", 'submittedOrderType: "FOK"', 'submittedOrderType: "GTC"'],
  ["fok/orderSettlement.ts", 'value?.fokCancellation && value.outcome === "unfilled"', 'value?.outcome === "unfilled"'],
])("rejects altered mode or evidence guards: %s", (suffix, before, after) => {
  expect(() => verifyPmFokCancellationContract(file => file.endsWith(suffix) ? read(file).replace(before, after) : read(file))).toThrow();
});
it("keeps unrelated submission changes visible to the original baseline", () => {
  const file = "packages/venue-adapter/polymarket/fok/bet.ts";
  expect(restorePmFokCancellationSource(file, read(file) + "\nvoid unexpectedSubmit();", true)).toContain("unexpectedSubmit");
});
it("does not exempt GTC or other paths", () => {
  expect(restorePmFokCancellationSource("packages/venue-adapter/polymarket/gtc/index.ts", "changed")).toBe("changed");
});

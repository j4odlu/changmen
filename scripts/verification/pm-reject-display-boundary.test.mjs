import fs from "node:fs";
import { expect, it } from "vitest";
import { restorePmRejectDisplaySource, verifyPmRejectDisplayContract } from "./pm-reject-display-boundary.mjs";
const read = file => fs.readFileSync(file, "utf8");
it("accepts only the exact reject quote display changes and optional quantity evidence", () => {
  expect(() => verifyPmRejectDisplayContract(read)).not.toThrow();
});
it.each([
  ["packages/shared/pm_submission.ts", "takerAmount > stakeUsdc", "takerAmount > 0"],
  ["client/web/src/shared/pmOrderDisplay.ts", "|| row.PmGtcExecutionId", "|| false"],
  ["server/backend/core/account/order/dto.js", "Number(r.player_id)", "317"],
  ["client/web/src/stores/account/betGateway.ts", "pending: true", "pending: false"],
  ["client/web/src/stores/betting/loseOrderPmPending.ts", "side: \"BUY\"", "side: \"SELL\""],
  ["client/web/src/components/order/OrderList.vue", "提交限价：", "成交价："],
])("rejects altered evidence or execution logic: %s", (file, before, after) => {
  expect(read(file)).toContain(before);
  expect(() => restorePmRejectDisplaySource(file, read(file).replace(before, after), true)).toThrow();
});
it("preserves the full previous source check instead of ignoring other changes", () => {
  const file = "client/web/src/shared/pmOrderDisplay.ts";
  expect(() => restorePmRejectDisplaySource(file, read(file) + "\nvoid unexpectedTrade();", true)).toThrow();
  expect(restorePmRejectDisplaySource("packages/venue-adapter/polymarket/fok/bet.ts", "changed")).toBe("changed");
});

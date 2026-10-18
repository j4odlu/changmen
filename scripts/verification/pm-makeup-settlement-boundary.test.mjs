import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { gitSource, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { pmMakeupSettlementIncrements } from "./pm-makeup-settlement-boundary.mjs";

const read = file => fs.readFileSync(file, "utf8");
const bases = ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"];
function check(file, source, base = bases[1]) {
  return verifyProtectedSource(file, source, gitSource(base, file), read, path => gitSource(base, path));
}

describe("PM makeup settlement keeps complete immutable FOK protection", () => {
  for (const file of Object.keys(pmMakeupSettlementIncrements)) {
    for (const base of bases) {
      it(`accepts the exact concurrency correction ${file}/${base}`, () => {
        expect(check(file, read(file), base).exactBoundaryVerified).toBe(true);
      });
      it(`rejects unrelated actions ${file}/${base}`, () => {
        expect(() => check(file, `${read(file)}\nvoid unexpectedSettlement();\n`, base)).toThrow();
      });
    }
  }
  for (const [name, before, after] of [
    ["loseOrderPmPending.ts", "pendingResumeFlights.has(params.order)", "false"],
    ["loseOrderPmPending.ts", "order.pendingVenueOrderId === pendingId", "true"],
    ["loseOrderPmPending.ts", "if (!isCurrentOrder())", "if (false)"],
    ["loseOrderPmPending.ts", "const currentAtCommit = isCurrentOrder();", "const currentAtCommit = true;"],
    ["loseOrder.ts", "loseStore.orders.get(betId) !== order", "false"],
  ]) {
    it(`rejects altered queue protection ${name}/${before}`, () => {
      const file = `client/web/src/stores/betting/${name}`;
      expect(read(file)).toContain(before);
      expect(() => check(file, read(file).replace(before, after))).toThrow();
    });
  }
});

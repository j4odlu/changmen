import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { a8MakeupIncrements } from "./a8-makeup-boundary.mjs";
import { gitSource, verifyProtectedSource } from "./fok-exact-boundaries.mjs";

const read = file => fs.readFileSync(file, "utf8");
const bases = ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"];
function check(file, source, base) {
  return verifyProtectedSource(file, source, gitSource(base, file), read, path => gitSource(base, path));
}

describe("exact A8 makeup corrections keep complete immutable module protection", () => {
  const syncFile = "client/web/src/stores/account/venueOrders.ts";
  for (const base of bases) {
    it(`accepts only the A8 order-save failure correction/${base}`, () => {
      expect(check(syncFile, read(syncFile), base).exactBoundaryVerified).toBe(true);
    });
    it(`rejects extra behavior after order-save failure/${base}`, () => {
      const source = read(syncFile);
      expect(source).toContain("return fetchedOrders;");
      expect(() => check(syncFile, source.replace("return fetchedOrders;", "return undefined;"), base)).toThrow();
      expect(() => check(syncFile, source.replace("onFetchedOrders?.(orders);", ""), base)).toThrow();
      expect(() => check(syncFile, `${source}\nvoid unexpectedOrderSync();\n`, base)).toThrow();
    });
  }
  for (const file of Object.keys(a8MakeupIncrements)) {
    for (const base of bases) {
      it(`accepts only the registered correction ${file}/${base}`, () => {
        expect(check(file, read(file), base).exactBoundaryVerified).toBe(true);
      });
      it(`rejects unrelated actions ${file}/${base}`, () => {
        expect(() => check(file, `${read(file)}\nvoid unexpectedMakeup();\n`, base)).toThrow();
      });
    }
  }
  for (const [file, before, after] of [
    ["loseOrder.ts", "!order.isCreateOrder && waitSec !== 0", "true"],
    ["loseOrder.ts", "consumeMakeUpQueue(loseStore, order, removeIds)", "loseStore.removeOrder(betId, true)"],
    ["loseOrderPm.ts", "await applyVenueJbSettlementOutcome(", "void applyVenueJbSettlementOutcome("],
    ["loseOrderPmPending.ts", "consumeMakeUpQueue(loseStore, order, removeIds);", "loseStore.removeOrder(betId, true);"],
    ["loseOrderPmPending.ts", "recordTerminal(false);", "void 0;"],
    ["makeUpReference.ts", "Number(leg.odds)", "Number(leg.newOdds ?? leg.odds)"],
    ["autoBet/retryFailedLeg.ts", "if (!retryLeg.data)", "if (!retryLeg.data || retryLeg.odds < 2)"],
  ]) {
    it(`rejects altered corrected semantics ${file}/${before}`, () => {
      const path = `client/web/src/stores/betting/${file}`;
      expect(read(path)).toContain(before);
      expect(() => check(path, read(path).replace(before, after), bases[1])).toThrow();
    });
  }
});

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { gitSource, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { pmMakeupLifecycleIncrements } from "./pm-makeup-settlement-boundary.mjs";

const read = file => fs.readFileSync(file, "utf8");
const bases = ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"];
function check(file, source, base = bases[1]) {
  return verifyProtectedSource(file, source, gitSource(base, file), read, path => gitSource(base, path));
}

describe("PM lifecycle corrections preserve both complete immutable FOK baselines", () => {
  for (const file of Object.keys(pmMakeupLifecycleIncrements)) {
    for (const base of bases) {
      it(`accepts only the exact lifecycle correction ${file}/${base}`, () => {
        expect(check(file, read(file), base).exactBoundaryVerified).toBe(true);
      });
      it(`rejects unrelated changes ${file}/${base}`, () => {
        expect(() => check(file, `${read(file)}\nvoid unexpectedLifecycle();\n`, base)).toThrow();
      });
    }
  }
  for (const [file, before, after] of [
    ["client/web/src/stores/betting/loseOrder.ts", "if (isCurrentOrder) {", "if (false) {"],
    ["client/web/src/stores/betting/loseOrderPmPending.ts", "countedResults.has(result)", "false"],
    ["client/web/src/stores/betting/loseOrderPmPending.ts", "recordTerminal(true);", "void 0;"],
    ["client/web/src/stores/betting/loseOrderPmPending.ts", "recordTerminal(false);", "void 0;"],
    ["client/web/src/stores/betting/loseOrderRegular.ts", "consumeMakeUpQueue(loseStore, order, removeIds);", "removeIds.add(betId);"],
    ["client/web/src/stores/loseOrderStore.ts", "this.clearPendingVenueOrder(order.betId, false);", "this.clearPendingVenueOrder(order.betId);"],
    ["client/web/src/stores/loseOrderStore.ts", "if (store.orders.get(order.betId) !== order)", "if (false)"],
    ["client/web/src/stores/loseOrderStore.ts", "if (consumedIds.has(order.betId))", "if (false)"],
  ]) {
    it(`rejects changed lifecycle semantics ${file}/${before}`, () => {
      expect(read(file)).toContain(before);
      expect(() => check(file, read(file).replace(before, after))).toThrow();
    });
  }
});

import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { gitSource, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { pmMakeupCompletionIncrements } from "./pm-makeup-settlement-boundary.mjs";

const read = withAdapterHistoryReader(file => readAdapterHistory(file, "utf8"));
const bases = ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"];
function check(file, source, base = bases[1]) {
  return verifyProtectedSource(file, source, gitSource(base, file), read, path => gitSource(base, path));
}

describe("PM completion preserves full fixed-baseline module checks", () => {
  for (const file of Object.keys(pmMakeupCompletionIncrements)) {
    for (const base of bases) {
      it(`accepts only the registered completion ${file}/${base}`, () => {
        expect(check(file, read(file), base).exactBoundaryVerified).toBe(true);
      });
      it(`rejects unrelated actions ${file}/${base}`, () => {
        expect(() => check(file, `${read(file)}\nvoid unexpectedCompletion();\n`, base)).toThrow();
      });
    }
  }
  for (const [name, before, after] of [
    ["loseOrderPmPending.ts", '.finally(() => {', '.then(() => {'],
    ["loseOrderPmPending.ts", 'if (!bound && orderId)', 'if (false)'],
    ["loseOrderPmPending.ts", 'continueDetachedObservation(ctx, scopeCurrent);', 'void 0;'],
    ["loseOrderRegular.ts", 'isAuthSessionCurrent(session)', 'true'],
    ["loseOrder.ts", 'if (removeIds.has(betId) || loseStore.orders.get(betId) !== order)', 'if (removeIds.has(betId))'],
    ["loseOrder.ts", '!isCurrentOrder || (!order.isCreateOrder && waitSec !== 0)', '!order.isCreateOrder && waitSec !== 0'],
  ]) {
    it(`rejects changed completion semantics ${name}/${before}`, () => {
      const file = `client/web/src/stores/betting/${name}`;
      expect(read(file)).toContain(before);
      expect(() => check(file, read(file).replace(before, after))).toThrow();
    });
  }
});

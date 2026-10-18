import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { gitSource, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { a8MakeupReceiptIncrements } from "./pm-makeup-settlement-boundary.mjs";

const read = file => fs.readFileSync(file, "utf8");
const bases = ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"];
function check(file, source, base = bases[1]) {
  return verifyProtectedSource(file, source, gitSource(base, file), read, path => gitSource(base, path));
}

describe("A8 accepted makeup receipt and finalization keep both immutable FOK baselines", () => {
  for (const file of Object.keys(a8MakeupReceiptIncrements)) {
    for (const base of bases) {
      it(`accepts only the exact receipt correction ${file}/${base}`, () => {
        expect(check(file, read(file), base).exactBoundaryVerified).toBe(true);
      });
      it(`rejects unrelated changes ${file}/${base}`, () => {
        expect(() => check(file, `${read(file)}\nvoid unexpectedReceipt();\n`, base)).toThrow();
      });
    }
  }
  for (const [file, before, after] of [
    ["client/web/src/stores/betting/loseOrder.ts", "if (!isCurrentOrder && !result?.success)", "if (!isCurrentOrder)"],
    ["client/web/src/stores/betting/loseOrderRegular.ts", "if (!params.resumeAccepted && (order.isCreateOrder || waitSec === 0))", "if (order.isCreateOrder || waitSec === 0)"],
    ["client/web/src/stores/betting/loseOrderRegular.ts", "receipt.rejected !== undefined ? null : await resolveVenueLegOutcome(", "false ? null : await resolveVenueLegOutcome("],
    ["client/web/src/stores/betting/loseOrderRegular.ts", "await bindArbLegOrder(", "void bindArbLegOrder("],
    ["client/web/src/stores/betting/loseOrderRegular.ts", "finish(rejected);", "void 0;"],
    ["client/web/src/stores/betting/loseOrderPmPending.ts", "order.pendingRegularReceipt.checkAt - Date.now()", "10000"],
    ["client/web/src/stores/loseOrderStore.ts", "if (!id && !opts.regularReceipt)", "if (!id)"],
    ["packages/client-core/src/models/loseOrder.ts", "Boolean(pendingId || this.pendingRegularReceipt)", "Boolean(pendingId)"],
  ]) {
    it(`rejects changed receipt semantics ${file}/${before}`, () => {
      expect(read(file)).toContain(before);
      expect(() => check(file, read(file).replace(before, after))).toThrow();
    });
  }
});

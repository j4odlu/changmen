import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import { readClientPackageSource } from "./client-package-relocation.mjs";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { describe, expect, it } from "vitest";
import { gitSource, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { pmMakeupTerminalIncrements } from "./pm-makeup-settlement-boundary.mjs";

const read = withAdapterHistoryReader(file => readClientPackageSource(file, readAdapterHistory(file, "utf8"), f => readAdapterHistory(f, "utf8")));
const bases = ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"];
function check(file, source, base = bases[1]) {
  return verifyProtectedSource(file, source, gitSource(base, file), read, path => gitSource(base, path));
}

describe("terminal makeup receipts retain complete immutable FOK modules", () => {
  for (const file of Object.keys(pmMakeupTerminalIncrements)) {
    for (const base of bases) {
      it(`accepts only the exact terminal correction ${file}/${base}`, () => {
        expect(check(file, read(file), base).exactBoundaryVerified).toBe(true);
      });
      it(`rejects extra actions ${file}/${base}`, () => {
        expect(() => check(file, `${read(file)}\nvoid unexpectedTerminalAction();\n`, base)).toThrow();
      });
    }
  }
  for (const [file, before, after] of [
    ["client/web/src/stores/betting/loseOrderPmPending.ts", "if (receipt) {", "if (false) {"],
    ["client/web/src/stores/betting/loseOrderPmPending.ts", "savedReceipt.accountId === account.accountId", "true"],
    ["client/web/src/stores/betting/loseOrderPmPending.ts", "try { loseStore.persist(); }", "try { void 0; }"],
    ["client/web/src/stores/loseOrderStore.ts", "existing.pendingVenueReceipt = undefined;", "void 0;"],
    ["packages/client-core/src/models/loseOrder.ts", "receipt.accountId === pendingAcc", "true"],
  ]) {
    it(`rejects altered terminal protections ${file}/${before}`, () => {
      expect(read(file)).toContain(before);
      expect(() => check(file, read(file).replace(before, after))).toThrow();
    });
  }
});

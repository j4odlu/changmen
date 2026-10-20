import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { describe, expect, it } from "vitest";
import { gitSource, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { makeupQueryRecoveryIncrements } from "./pm-makeup-settlement-boundary.mjs";

const read = file => fs.readFileSync(file, "utf8");
const bases = ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"];
function check(file, source, base = bases[1]) {
  return verifyProtectedSource(file, source, gitSource(base, file), read, path => gitSource(base, path));
}

describe("makeup query recovery keeps complete immutable FOK modules", () => {
  for (const file of Object.keys(makeupQueryRecoveryIncrements)) {
    for (const base of bases) {
      it(`accepts only the exact query recovery ${file}/${base}`, () => {
        expect(check(file, read(file), base).exactBoundaryVerified).toBe(true);
      });
      it(`rejects unrelated actions ${file}/${base}`, () => {
        expect(() => check(file, `${read(file)}\nvoid unexpectedQueryRecovery();\n`, base)).toThrow();
      });
    }
  }
  for (const [name, before, after] of [
    ["loseOrderRegular.ts", "if (observationRetries.has(order))", "if (false)"],
    ["loseOrderRegular.ts", "isAuthSessionCurrent(session)", "true"],
    ["loseOrderRegular.ts", "current.token === token", "true"],
    ["loseOrderRegular.ts", "current.gateway === gateway", "true"],
    ["loseOrderRegular.ts", "if (pending && scopeCurrent())", "if (pending)"],
    ["loseOrderRegular.ts", "continueMakeUpObservation(order, scopeCurrent,", "void 0; broken("],
    ["loseOrderRegular.ts", "(receipt.checkAt - Date.now()) / 1000", "10"],
    ["loseOrderPmPending.ts", "continueDetachedObservation(ctx, scopeCurrent);", "void 0;"],
    ["loseOrderPmPending.ts", "isMakeUpObservationRetrying(params.order)", "false"],
  ]) {
    it(`rejects altered observation protections ${name}/${before}`, () => {
      const file = `client/web/src/stores/betting/${name}`;
      expect(read(file)).toContain(before);
      expect(() => check(file, read(file).replace(before, after))).toThrow();
    });
  }
});

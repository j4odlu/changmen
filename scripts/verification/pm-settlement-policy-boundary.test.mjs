import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { readRelocatedPmFunctionalSource } from "./pm-functional-source-relocation.mjs";
import { PM_OFFICIAL_SETTLEMENT_SOURCES, verifyPmOfficialSettlementSource } from "./pm-settlement-policy-boundary.mjs";

describe("authorized official-priority settlement with price fallback boundary", () => {
  for (const file of Object.keys(PM_OFFICIAL_SETTLEMENT_SOURCES)) {
    const source = () => readRelocatedPmFunctionalSource(file, readAdapterHistory(file, "utf8"));
    it(`${file}: accepts the complete reviewed implementation`, () => {
      expect(verifyPmOfficialSettlementSource(file, source())).toBe(true);
    });
    it(`${file}: rejects additional code and changed imports`, () => {
      expect(() => verifyPmOfficialSettlementSource(file, `${source()}\nvoid unexpectedAction();\n`)).toThrow("exact reviewed");
      expect(() => verifyPmOfficialSettlementSource(file, source().replace('"./orders"', '"./otherOrders"').replace('"./api"', '"./otherApi"'))).toThrow("exact reviewed");
    });
    it(`${file}: rejects the unreviewed historical price policy`, () => {
      const previous = execFileSync("git", ["show", `e901bb596952256284cd8a9eb8b73b572c963915:${file}`], { encoding: "utf8" });
      expect(() => verifyPmOfficialSettlementSource(file, previous)).toThrow("exact reviewed");
    });
  }
  it("does not exempt other modules", () => {
    expect(verifyPmOfficialSettlementSource("packages/venue-adapter/polymarket/bet.ts", "unexpected source")).toBe(false);
  });
});

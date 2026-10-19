import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { describe, it } from "vitest";
import { specializeFokSource } from "./fok-source-specialization.mjs";
import { VENUE_BROWSER_STATE } from "./venue-browser-state.mjs";
import { PM_FOK_RELOCATIONS, pmFokCompatibilitySource, readRelocatedPmFokSource, rebasePmFokImports } from "./pm-fok-source-relocation.mjs";

describe("pM FOK relocation preserves the complete immutable source", () => {
  for (const [file, target] of Object.entries(PM_FOK_RELOCATIONS)) {
    for (const base of ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"]) {
      it(`${file}: compares the whole relocated implementation with ${base}`, () => {
        const original = execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" }).replace(/\r\n/g, "\n");
        assert.equal(specializeFokSource(file, readAdapterHistory(file, "utf8")), original);
      });
    }
    it(`${file}: rejects extra work in the compatibility entry`, () => {
      assert.throws(() => readRelocatedPmFokSource(file, `${pmFokCompatibilitySource(file)}\nsetTimeout(() => {}, 1);\n`));
    });
    it(`${file}: leaves an implementation change visible`, () => {
      const wrapper = pmFokCompatibilitySource(file);
      const moved = restoreVenueBrowserExecution(target, readAdapterHistory(target, "utf8"));
      if (VENUE_BROWSER_STATE.rows.some(row => row.file === target)) {
        assert.throws(() => readRelocatedPmFokSource(file, wrapper, () => `${moved}\nthrow new Error("changed execution");\n`), /exact state facade/);
        return;
      }
      if (file === "packages/venue-adapter/polymarket/bet.ts") {
        assert.throws(() => readRelocatedPmFokSource(file, wrapper, () => `${moved}\nthrow new Error("changed execution");\n`), /exact unified PM preflight increment/);
        return;
      }
      assert.notEqual(readRelocatedPmFokSource(file, wrapper, () => `${moved}\nthrow new Error("changed execution");\n`), readRelocatedPmFokSource(file, wrapper));
    });
    it(`${file}: rejects an alternative target`, () => {
      assert.throws(() => readRelocatedPmFokSource(file, pmFokCompatibilitySource(file).replace("./fok/", "./gtc/")));
    });
  }
  it("keeps dependency changes visible instead of dropping all imports", () => {
    const file = "packages/venue-adapter/polymarket/bet.ts";
    const moved = restoreVenueBrowserExecution(PM_FOK_RELOCATIONS[file], readAdapterHistory(PM_FOK_RELOCATIONS[file], "utf8"));
    assert(moved.includes("from \"../pmClientApi\""));
    const wrapper = pmFokCompatibilitySource(file);
    assert.throws(() => readRelocatedPmFokSource(file, wrapper, () => moved.replace("from \"../pmClientApi\"", "from \"../otherApi\"")), /exact unified PM preflight increment/);
  });
  it("does not exempt unrelated files", () => {
    const source = "export * from \"./fok/bet\";\n";
    assert.equal(readRelocatedPmFokSource("client/web/src/runtime/providers.ts", source), source);
  });
  it("round-trips static exports, dynamic imports and import types without rewriting ordinary strings", () => {
    const file = "packages/venue-adapter/polymarket/example.ts";
    const target = "packages/venue-adapter/polymarket/fok/example.ts";
    const source = "import { x } from \"./api\";\nexport { y } from \"../contract\";\nconst load = () => import(\"./settlementJob.js\");\ntype Row = import(\"./orderTypes\").PolymarketOrderRow;\nconst message = \"./api\";\n";
    const moved = rebasePmFokImports(source, file, target);
    assert(moved.includes("import(\"../settlementJob.js\")"));
    assert(moved.includes("const message = \"./api\""));
    assert.equal(rebasePmFokImports(moved, target, file), source);
  });
});

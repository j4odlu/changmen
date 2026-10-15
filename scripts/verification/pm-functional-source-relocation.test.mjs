import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { rebasePmFokImports } from "./pm-fok-source-relocation.mjs";
import { PM_FUNCTIONAL_RELOCATIONS, pmFunctionalCompatibilitySource, readRelocatedPmFunctionalSource } from "./pm-functional-source-relocation.mjs";
import { verifyPmOfficialSettlementSource } from "./pm-settlement-policy-boundary.mjs";
import { restorePmTickRefreshSource } from "./pm-tick-refresh-boundary.mjs";
import { restorePmOrderBetLabelSource } from "./pm-order-bet-label-boundary.mjs";
import { restorePmPreflightSource } from "./pm-preflight-boundary.mjs";

const base = "e901bb596952256284cd8a9eb8b73b572c963915";
describe("pM functional relocation preserves complete implementations", () => {
  for (const [file, target] of Object.entries(PM_FUNCTIONAL_RELOCATIONS)) {
    it(`${file}: matches the fixed original implementation and dependency targets`, () => {
      const original = execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" }).replace(/\r\n/g, "\n");
      const current = readRelocatedPmFunctionalSource(file, fs.readFileSync(file, "utf8"));
      if (!verifyPmOfficialSettlementSource(file, current))
        expect(current).toBe(original);
    });
    it(`${file}: rejects added facade side effects and incorrect targets`, () => {
      const facade = pmFunctionalCompatibilitySource(file);
      expect(() => readRelocatedPmFunctionalSource(file, `${facade}throw new Error('extra action');\n`)).toThrow("compatibility entry");
      expect(() => readRelocatedPmFunctionalSource(file, facade.replace("export *", "export { missing }"))).toThrow("compatibility entry");
    });
    it(`${file}: exposes changes in the implementation behind the facade`, () => {
      const facade = pmFunctionalCompatibilitySource(file);
      const original = readRelocatedPmFunctionalSource(file, facade);
      const mutated = readRelocatedPmFunctionalSource(file, facade, (requested) => {
        return fs.readFileSync(requested, "utf8") + (requested === target ? "\nthrow new Error('changed implementation');\n" : "");
      });
      expect(mutated).not.toBe(original);
      expect(mutated).toContain("changed implementation");
    });
    it(`${file}: resolves every relative dependency to its original module`, () => {
      const original = execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" });
      const moved = restorePmTickRefreshSource(target, restorePmOrderBetLabelSource(target, restorePmPreflightSource(target, fs.readFileSync(target, "utf8")), file => fs.readFileSync(file, "utf8")));
      const imports = (source, filename) => {
        const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
        const result = [];
        const visit = (node) => {
          if (ts.isStringLiteral(node) && node.text.startsWith(".")) {
            const parent = node.parent;
            if (((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node)
              || (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword)
              || (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent))) {
              const resolved = ts.resolveModuleName(node.text, path.resolve(filename), { moduleResolution: ts.ModuleResolutionKind.Bundler }, ts.sys).resolvedModule;
              assert(resolved, `${filename}: cannot resolve ${node.text}`);
              result.push(path.resolve(resolved.resolvedFileName));
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(sf);
        return result;
      };
      expect(imports(moved, target)).toEqual(imports(original, file));
    });
  }
  it("does not exempt an unregistered file or change GTC/FOK ownership", () => {
    for (const file of ["client/web/src/runtime/providers.ts", "packages/venue-adapter/polymarket/gtc/index.ts", "packages/venue-adapter/polymarket/fok/bet.ts"]) {
      expect(PM_FUNCTIONAL_RELOCATIONS[file]).toBeUndefined();
      expect(readRelocatedPmFunctionalSource(file, "throw new Error('must remain visible');\n"))
        .toBe("throw new Error('must remain visible');\n");
    }
  });
  it("preserves a file reference when the new directory has the same name", () => {
    const source = "import { order } from './orders';\n";
    const moved = rebasePmFokImports(source, "pm/legOutcome.ts", "pm/orders/legOutcome.ts");
    expect(moved).toBe("import { order } from '../orders';\n");
    expect(rebasePmFokImports(moved, "pm/orders/legOutcome.ts", "pm/legOutcome.ts")).toBe(source);
  });
  it("preserves a file reference when it shares the name of an ancestor directory", () => {
    const source = "import { order } from './orders';\n";
    const moved = rebasePmFokImports(source, "pm/legOutcome.ts", "pm/orders/history/legOutcome.ts");
    expect(moved).toBe("import { order } from '../../orders';\n");
    expect(rebasePmFokImports(moved, "pm/orders/history/legOutcome.ts", "pm/legOutcome.ts")).toBe(source);
  });
});

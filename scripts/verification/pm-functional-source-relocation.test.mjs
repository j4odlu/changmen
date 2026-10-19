import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { rebasePmFokImports } from "./pm-fok-source-relocation.mjs";
import { PM_FUNCTIONAL_RELOCATIONS, pmFunctionalCompatibilitySource, readRelocatedPmFunctionalSource, restorePmOutcomeArchiveSource } from "./pm-functional-source-relocation.mjs";
import { verifyPmOfficialSettlementSource } from "./pm-settlement-policy-boundary.mjs";
import { restorePmTickRefreshSource } from "./pm-tick-refresh-boundary.mjs";
import { restorePmOrderBetLabelSource } from "./pm-order-bet-label-boundary.mjs";
import { restorePmPreflightSource } from "./pm-preflight-boundary.mjs";
import { restorePmWsQuantityEvidenceSource } from "./pm-ws-quantity-evidence-boundary.mjs";
import { VENUE_BROWSER_LEAVES, readVenueBrowserLeafSource } from "./venue-browser-leaves.mjs";
import { VENUE_BROWSER_STATE } from "./venue-browser-state.mjs";
import { restoreVenueBrowserExecution } from './venue-browser-execution.mjs';
import { restoreVenueBrowserMarketHosts, VENUE_BROWSER_MARKET_HOSTS } from './venue-browser-market-hosts.mjs';

const base = "e901bb596952256284cd8a9eb8b73b572c963915";
describe("pM functional relocation preserves complete implementations", () => {
  it("restores only the registered result archive loop, retaining winner policy and all other code for full verification", () => {
    const file = "packages/venue-adapter/polymarket/markets/pmMapOutcomeStore.ts";
    const source = restoreVenueBrowserMarketHosts(file, fs.readFileSync(file, "utf8"));
    const restored = restorePmOutcomeArchiveSource(file, source);
    expect(restored).toContain('entry.outcomeKind !== "official"');
    expect(restored).not.toContain("index.outcomeEntries");
    expect(restorePmOutcomeArchiveSource(file, source + "\nthrow Error('extra');")).toContain("throw Error('extra')");
    expect(() => restorePmOutcomeArchiveSource(file, source.replace("index.outcomeEntries", "index.entries"))).toThrow();
    expect(() => restorePmOutcomeArchiveSource(file, source.replace('replacePmMapIdentitiesFromIndex(index);', 'replacePmMapIdentitiesFromIndex(null);'))).toThrow('exact display-only map identity hook');
    expect(restorePmOutcomeArchiveSource("unregistered.ts", source)).toBe(source);
  });
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
      const readMutated = () => readRelocatedPmFunctionalSource(file, facade, (requested) => {
        const source = fs.readFileSync(requested, "utf8");
        if (requested === target && VENUE_BROWSER_MARKET_HOSTS.changes.some(row => row.file === target))
          return restoreVenueBrowserMarketHosts(target, source) + "\nthrow new Error('changed implementation');\n";
        return requested === target && target.endsWith('/diagnostics/orderTrace.ts')
          ? restoreVenueBrowserExecution(target, source) + "\nthrow new Error('changed implementation');\n"
          : source + (requested === target ? "\nthrow new Error('changed implementation');\n" : "");
      });
      if (target === "packages/venue-adapter/polymarket/diagnostics/orderTrace.ts") {
        expect(readMutated).toThrow("exact diagnostic-only WS change");
        return;
      }
      if (["packages/venue-adapter/polymarket/realtime/ws.ts", "packages/venue-adapter/polymarket/realtime/sportMarketWs.ts"].includes(target)) {
        // A modified forwarding entry cannot restore the complete registered lifecycle source.
        expect(readMutated).toThrow("exact tick-size refresh change");
        return;
      }
      if (target === "packages/venue-adapter/polymarket/quotes/pmTickMetadata.ts") {
        expect(readMutated).toThrow("exact tick-size refresh change");
        return;
      }
      if (VENUE_BROWSER_LEAVES.rows.some(row => row.file === target)) {
        expect(readMutated).toThrow("exact leaf facade");
        return;
      }
      if (VENUE_BROWSER_STATE.rows.some(row => row.file === target)) {
        expect(readMutated).toThrow("exact state facade");
        return;
      }
      const mutated = readMutated();
      expect(mutated).not.toBe(original);
      expect(mutated).toContain("changed implementation");
    });
    it(`${file}: resolves every relative dependency to its original module`, () => {
      const original = execFileSync("git", ["show", `${base}:${file}`], { encoding: "utf8" });
      const moved = restorePmTickRefreshSource(target, restorePmOrderBetLabelSource(target, restorePmPreflightSource(target, restorePmWsQuantityEvidenceSource(target, restorePmOutcomeArchiveSource(target, readVenueBrowserLeafSource(target, fs.readFileSync(target, "utf8"))))), file => fs.readFileSync(file, "utf8")));
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

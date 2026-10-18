import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { gitSource, moduleTokens, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { replaceExact } from "./fok-exact-boundaries.mjs";
import { restoreUnifiedArbitrageSource } from "./unified-arb-boundaries.mjs";
import { PM_FOK_RELOCATIONS, readRelocatedPmFokSource } from "./pm-fok-source-relocation.mjs";
import { PM_FUNCTIONAL_RELOCATIONS, readRelocatedPmFunctionalSource } from "./pm-functional-source-relocation.mjs";
import { restorePublishedPmSettlement } from "./pm-published-settlement-boundary.mjs";
import { restoreMinimalOrdersSource } from "./pm-orders-minimal-boundary.mjs";
import { restoreRayProviderSource, restoreRayFinalizeSource } from "./ray-frontend-boundary.mjs";
import { restorePmManualSellSplit } from "./pm-manual-sell-split-boundary.mjs";

// [changmen 扩展] 执行辅助检查器的真实读取函数和完整保护循环；不运行交易或改写被保护文件。
const file = "scripts/verification/verify-fok-reviewed-differences.mjs";
const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
const reader = sf.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "currentSource");
const loop = sf.statements.filter(node => ts.isForOfStatement(node) && node.expression.getText(sf) === "Object.entries(manifest.protectedFiles)");
assert(reader);
assert.equal(loop.length, 1);
const manifest = JSON.parse(fs.readFileSync("scripts/verification/vps-fok-baseline.json", "utf8"));
const relocations = { ...PM_FOK_RELOCATIONS, ...PM_FUNCTIONAL_RELOCATIONS };
const sha = source => createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex");
const originals = new Map();
const files = Object.keys(manifest.protectedFiles);
const objects = execFileSync("git", ["cat-file", "--batch"], {
  input: `${files.map(file => `${manifest.version}:${file}`).join("\n")}\n`,
  maxBuffer: 30 * 1024 * 1024,
});
let offset = 0;
for (const file of files) {
  const end = objects.indexOf(10, offset);
  const header = objects.subarray(offset, end).toString("utf8").split(" ");
  assert.equal(header[1], "blob");
  const size = Number(header[2]);
  originals.set(file, objects.subarray(end + 1, end + 1 + size).toString("utf8"));
  offset = end + 1 + size + 1;
}
function check(paths, readSource = target => fs.readFileSync(target, "utf8"), expectedOverrides = {}) {
  const protectedFiles = Object.fromEntries(paths.map(file => [file, expectedOverrides[file] ?? manifest.protectedFiles[file]]));
  return JSON.parse(vm.runInNewContext(`${reader.getText(sf)}\nlet exactFiles = 0; const differences = [];\n${loop[0].getText(sf)}\nJSON.stringify({ exactFiles, differences });`, {
    assert,
    sha,
    fs: { readFileSync: readSource },
    readRelocatedPmFokSource,
    readRelocatedPmFunctionalSource,
    restoreUnifiedArbitrageSource,
    restorePublishedPmSettlement, restoreMinimalOrdersSource, restoreRayProviderSource, restoreRayFinalizeSource,
    replaceExact,
    gitSource,
    verifyProtectedSource,
    base: manifest.version,
    oldSource: file => originals.get(file),
    reviewed: new Map(),
    manifest: { protectedFiles },
  }, { timeout: 10000 }));
}
function change(target, transform) {
  return requested => transform(fs.readFileSync(requested, "utf8"), requested === target);
}

describe("supplementary FOK audit reads full relocated source without exemptions", () => {
  it("accepts all 83 original PM modules through their registered compatibility entries", () => {
    expect(Object.keys(relocations)).toHaveLength(83);
    expect(check(Object.keys(relocations))).toEqual({ exactFiles: 83, differences: [] });
  });
  for (const file of ["packages/venue-adapter/polymarket/bet.ts", "packages/venue-adapter/polymarket/pmSubmitJournal.ts"]) {
    it(`${file}: rejects implementation changes hidden behind the old entry`, () => {
      expect(() => check([file], change(relocations[file], (source, matched) => matched ? `${source}\nthrow new Error('changed business');\n` : source)))
        .toThrow(`unregistered protected source difference`);
    });
    it(`${file}: rejects added actions and wrong targets in the old entry`, () => {
      expect(() => check([file], change(file, (source, matched) => matched ? `${source}\nsetTimeout(() => {}, 1);\n` : source)))
        .toThrow("compatibility entry");
      expect(() => check([file], change(file, (source, matched) => matched ? source.replace("export *", "export { missing }") : source)))
        .toThrow("compatibility entry");
    });
  }
  it("rejects changed dependencies rather than removing imports", () => {
    const file = "packages/venue-adapter/polymarket/bet.ts";
    expect(fs.readFileSync(relocations[file], "utf8")).toContain("from \"../pmClientApi\"");
    expect(() => check([file], change(relocations[file], (source, matched) => matched ? source.replace("from \"../pmClientApi\"", "from \"../otherApi\"") : source)))
      .toThrow(`exact unified PM preflight increment`);
  });
  it("accepts only the precise notification wrapper and rejects changed POST arguments", () => {
    const file = "client/web/src/stores/account/betGateway.ts";
    expect(check([file]).differences).toEqual([file]);
    expect(() => check([file], change(file, (source, matched) => matched ? source.replace("provider.betting(account, option)", "provider.betting(account, {})") : source))).toThrow("complete source outside reject display change");
  });
  it("checks the exact DisplayOnly guard without allowing a wider exemption", () => {
    const file = "client/web/src/shared/orderLink.ts";
    expect(check([file]).differences).toEqual([file]);
    expect(() => check([file], change(file, (source, matched) => matched ? source.replace("if (row.DisplayOnly)", "if (row.DisplayOnly || row.Type === 'RAY')") : source))).toThrow();
  });
  it("continues checking immutable baseline provenance before current source", () => {
    const file = "packages/venue-adapter/polymarket/api.ts";
    expect(() => check([file], undefined, { [file]: "0".repeat(64) })).toThrow(`immutable VPS provenance: ${file}`);
  });
  it("fails if the registered implementation is missing", () => {
    const file = "packages/venue-adapter/polymarket/api.ts";
    expect(() => check([file], (requested) => {
      if (requested === relocations[file])
        throw new Error("missing registered implementation");
      return fs.readFileSync(requested, "utf8");
    })).toThrow("missing registered implementation");
  });
});

const manualFile = "client/web/src/stores/account/pmManualSell.ts";
const manualSource = fs.readFileSync(manualFile, "utf8").replace(/\r\n/g, "\n");
const manualDeclarations = ["replace", "restoreGtcManualSellBody", "reviewPmManualSell", "review"].map((name) => {
  const fn = sf.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert(fn, name);
  return fn.getText(sf);
}).join("\n");
const printer = ts.createPrinter({ removeComments: true });
const canonical = source => printer.printFile(ts.createSourceFile(manualFile, source, ts.ScriptTarget.Latest, true)).replace(/\s+/g, " ").trim();
function checkManual(source) {
  return JSON.parse(vm.runInNewContext(`${manualDeclarations}\nreview(manualFile, 'manual sale', source => reviewPmManualSell(source, oldSource(manualFile)));\nJSON.stringify([...reviewed.values()]);`, {
    assert,
    ts,
    printer,
    canonical,
    moduleTokens,
    restorePmManualSellSplit,
    manualFile,
    currentSource: () => source,
    oldSource: () => originals.get(manualFile),
    reviewed: new Map(),
  }, { timeout: 10000 }));
}
function alterHelper(before, after) {
  const sourceTree = ts.createSourceFile(manualFile, manualSource, ts.ScriptTarget.Latest, true);
  const helper = sourceTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "persistGtcFilledSell");
  const body = helper.getText(sourceTree);
  assert(body.includes(before), before);
  return manualSource.slice(0, helper.getStart(sourceTree)) + body.replace(before, after) + manualSource.slice(helper.getEnd());
}

describe("supplementary manual sale audit verifies both the private helper and entire original module", () => {
  it("accepts the exact identity dispatch and private extraction with the same fixed VPS source", () => {
    expect(checkManual(manualSource)).toEqual([{ file: manualFile, kind: "manual sale", entireFokSpecializationIdentical: true }]);
  });
  const gate = "if (buyRow.PmGtcExecutionId)\n    return persistGtcFilledSell(account, buyRow, ordersToSave);";
  const cases = [
    ["widened identity gate", () => manualSource.replace("if (buyRow.PmGtcExecutionId)", "if (buyRow.PmGtcExecutionId || buyRow.Type === 'Polymarket')")],
    ["wrong helper arguments", () => manualSource.replace("return persistGtcFilledSell(account, buyRow, ordersToSave);", "return persistGtcFilledSell(account, buyRow, []);")],
    ["work before the identity gate", () => manualSource.replace(gate, `void saveOrders(account, []);\n  ${gate}`)],
    ["missing helper", () => manualSource.replace("async function persistGtcFilledSell(", "async function anotherPrivateFunction(")],
    ["duplicate helper", () => `${manualSource}\nasync function persistGtcFilledSell() {}\n`],
    ["exported helper", () => manualSource.replace("async function persistGtcFilledSell(", "export async function persistGtcFilledSell(")],
    ["default exported helper", () => manualSource.replace("async function persistGtcFilledSell(", "export default async function persistGtcFilledSell(")],
    ["synchronous helper", () => manualSource.replace("async function persistGtcFilledSell(", "function persistGtcFilledSell(")],
    ["extra helper call", () => `${manualSource}\npersistGtcFilledSell(account, row, orders);\n`],
    ["helper alias", () => `${manualSource}\nconst bypass = persistGtcFilledSell;\n`],
    ["changed helper payload", () => alterHelper("ordersToSave.map(row =>", "ordersToSave.slice(1).map(row =>")],
    ["wrong GTC writer", () => alterHelper("@/orderModes/gtc/ordersApi", "@/api/order")],
    ["changed helper session boundary", () => alterHelper("if (!current()) return false;", "if (false) return false;")],
    ["changed helper signature", () => alterHelper("ordersToSave: VenueOrder[]", "ordersToSave: VenueOrder[] = []")],
    ["new helper action", () => alterHelper("const sessionVersion =", "await saveOrders(account, []);\n  const sessionVersion =")],
    ["changed ordinary retry payload", () => manualSource.replace("await saveOrders(account, ordersToSave);", "await saveOrders(account, []);")],
    ["new module action", () => `${manualSource}\nvoid saveOrders(account, []);\n`],
    ["changed ordinary API dependency", () => manualSource.replace("from \"@/api/order\"", "from \"@/orderModes/gtc/ordersApi\"")],
  ];
  for (const [name, candidate] of cases) {
    it(`rejects ${name}`, () => {
      const altered = candidate();
      expect(altered).not.toBe(manualSource);
      expect(() => checkManual(altered)).toThrow();
    });
  }
});

// Deterministic self-test impact selection using source references, never imported application code.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));
export const dailyVerifierTests = [
  "backend-db-boundary", "backend-dynamic-paths", "component-entry-boundary", "component-install-inputs",
  "source-ownership-contracts", "venue-node-dependencies", "pm-loader-bindings",
  "pm-shared-loader-evidence", "pm-current-dependencies", "frontend-build-contracts",
  "current-boundaries", "daily-boundaries", "verification-selection",
].map(name => `scripts/verification/${name}.test.mjs`);
const plannerTests = new Set(["validation-plan.test.mjs", "verify-change.test.mjs"].map(name => "scripts/verification/" + name));
const specialNodeTest = "scripts/verification/fok-source-specialization.test.mjs";
// These old suites mixed current checks with whole-source migration proofs.
// Their current cases now live in the dedicated daily suites above.
const replacedHistoricalSuites = new Set(["scripts/verification/pm-dependency-audit.mjs", "scripts/verification/source-ownership.mjs"]);
const clean = file => {
  file = file.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!file || path.posix.isAbsolute(file) || /^[a-z]:/i.test(file) || file.split("/").includes("..")) throw Error("Invalid verifier selection path");
  return file;
};
export function selectVerificationTests(changed, { root = repository, dailyTests = dailyVerifierTests } = {}) {
  const inputs = [...new Set(changed.map(clean))].sort(), selected = new Set(), historical = new Set(), reasons = [];
  const exists = file => fs.existsSync(path.join(root, file)) && fs.statSync(path.join(root, file)).isFile();
  const references = new Map();
  function dependencies(file, seen = new Set()) {
    if (seen.has(file)) return seen;
    seen.add(file);
    if (!/\.[cm]?[jt]sx?$/.test(file) || !exists(file)) return seen;
    if (!references.has(file)) {
      const source = fs.readFileSync(path.join(root, file), "utf8"), targets = new Set();
      // An over-approximation: literal imports, re-exports, new URL(), require()
      // and file reads all count. References in fixtures/comments may add tests;
      // they cannot remove a real literal dependency.
      for (const match of source.matchAll(/(["'`])((?:\.\.?\/|scripts\/|devtools\/)[^"'`\r\n$]+)\1/g)) {
        const target = path.posix.normalize(match[2].startsWith(".") ? path.posix.join(path.posix.dirname(file), match[2]) : match[2]);
        if (target === ".." || target.startsWith("../") || path.posix.isAbsolute(target)) continue;
        targets.add(target);
        for (const suffix of ["", ".mjs", ".js", ".cjs", ".ts", "/index.mjs", "/index.js"]) if (exists(target + suffix)) {
          targets.add(target + suffix); break;
        }
      }
      references.set(file, targets);
    }
    for (const target of references.get(file)) dependencies(target, seen);
    return seen;
  }
  const closures = new Map(dailyTests.map(file => {
    if (!exists(file)) throw Error("Required verifier self-test is missing: " + file);
    return [file, dependencies(file)];
  }));
  for (const file of inputs) {
    if (plannerTests.has(file) || /^scripts\/verification\/(?:validation-plan|verify-change)\.mjs$/.test(file)
      || file === specialNodeTest || file === "scripts/verification/fok-source-specialization.mjs") continue;
    if (!/^scripts\/verification\//.test(file) && file !== "scripts/check-team-boundaries.mjs"
      && file !== "devtools/venue-adapter/verification/check-esport-freeze.mjs") continue;
    let covered = false;
    for (const [test, closure] of closures) if (closure.has(file)) { selected.add(test); covered = true; }
    const globalEntry = file === "scripts/check-team-boundaries.mjs"
      || /^scripts\/verification\/(?:verification-selection|run-self-tests)\.(?:mjs|test\.mjs)$/.test(file);
    if (globalEntry) { for (const test of dailyTests) selected.add(test); covered = true; }
    // An archived verifier implementation/test gets its own regression, never
    // the entire historical suite. Evidence-only JSON does not trigger old proofs.
    if (/\.[cm]?[jt]s$/.test(file) && !dailyTests.includes(file)) {
      const ownTest = /\.test\.[cm]?[jt]s$/.test(file) ? file : file.replace(/\.[cm]?[jt]s$/, ".test.mjs");
      if (exists(ownTest) && ownTest !== specialNodeTest && !replacedHistoricalSuites.has(file)) {
        (dailyTests.includes(ownTest) ? selected : historical).add(ownTest); covered = true;
      }
    }
    if (!covered && /\.[cm]?[jt]s$/.test(file)) {
      for (const test of dailyTests) selected.add(test);
      reasons.push({ file, reason: "unmapped or deleted verifier; all current guards retained" });
    }
  }
  return { inputs, tests: [...selected].sort(), historicalTests: [...historical].sort(), reasons };
}

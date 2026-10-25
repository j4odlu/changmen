/** [changmen 扩展] 日常检查和发布按范围离线验证；完整专项审计保留独立入口。 */
import { classifyDeployScope } from "../deploy/classify-deploy-scope.mjs";

const controlPatterns = [
  /^scripts\/(?:verification|deploy)\//,
  /^\.github\//,
  /^sh\/(?:deploy-[^/]+\.sh|_common\.sh)$/,
  /^deploy\/scripts\/release-(?:common|backend|frontend)\.sh$/,
];
function normalize(file) {
  const clean = file.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!clean || clean.startsWith("/") || clean.split("/").some(p => p === "..") || clean.includes("\0")) throw Error("Invalid changed path");
  return clean;
}
export function validationPlan(changedPaths, { publication = false, components = ["backend", "frontend"], release = publication, forceTests = false } = {}) {
  if (!Array.isArray(changedPaths) || changedPaths.some(p => typeof p !== "string")) throw Error("Changed paths required");
  const paths = [...new Set(changedPaths.map(normalize))].sort();
  const relevant = paths.filter(p => !/\.md$/i.test(p) && !/^(?:docs\/|output\/|\.playwright-cli\/)/.test(p));
  let frontend = false, backend = false, controls = false; const fullReasons = [];
  for (const file of relevant) {
    if (controlPatterns.some(p => p.test(file))) { controls = true; continue; }
    // Validation follows the same physical ownership as publication. RDS maintenance
    // still exercises backend behavior even though it never publishes an application.
    const scope = /^(?:(?:rds|server\/db)\/|server\/backend\/db\/)/.test(file) ? "backend" : classifyDeployScope([file]);
    if (scope === "frontend") frontend = true;
    else if (scope === "backend") backend = true;
    else fullReasons.push(file);
  }
  const full = fullReasons.length > 0 || !paths.length || forceTests;
  const testsNeeded = forceTests || !relevant.length || !relevant.every(file => controlPatterns.some(pattern => pattern.test(file))
    || /^deploy\/scripts\/release-(?:common|frontend|backend)\.sh$/.test(file));
  const tier = publication ? components.length === 2 ? "integration" : components[0]
    : full ? "full" : frontend && backend ? "integration" : frontend ? "frontend" : backend ? "backend" : controls ? "controls" : "docs";
  // 后端入口本身含 test:checks，避免再串联一次相同边界检查。
  const checkBackend = backend || full, checkFrontend = frontend || full;
  // These entry points and their tests are already covered by validation-control
  // (and their deploy consumers by deployment-control). Unknown/shared audit
  // implementations still require the entire verification suite.
  const validationControls = new Set(["validation-plan.mjs", "validation-plan.test.mjs", "verify-change.mjs", "verify-change.test.mjs"]);
  const verificationChanged = relevant.some(file => /^scripts\/verification\//.test(file)
    && !validationControls.has(file.slice("scripts/verification/".length)));
  // Historical FOK snapshots belong to explicit audits. Application risk alone
  // must not trigger the verifier's own source-mutation regression suite.
  const validationChanged = relevant.some(file => /^scripts\/verification\/(?:validation-plan|verify-change)(?:\.test)?\.mjs$/.test(file)
    || /^scripts\/deploy\/change-plan(?:\.test)?\.mjs$/.test(file));
  const controlChecks = [...(validationChanged ? ["validation-control"] : []),
    ...(verificationChanged ? ["verification-control", "verification-node"] : [])];
  const releaseChecks = [...controlChecks];
  if (publication) {
    if (!components.includes("backend") || !testsNeeded) releaseChecks.push("boundaries");
    if (components.includes("backend")) releaseChecks.push("router-compile", ...(testsNeeded ? ["backend"] : []));
    if (components.includes("frontend")) releaseChecks.push(...(testsNeeded ? ["frontend"] : []), "build");
  }
  return { tier, paths, fullReasons, immutableFokEntries: 0, snapshotOverridesAllowed: false,
    checks: release ? releaseChecks : [...controlChecks,
      ...(checkFrontend && !checkBackend ? ["boundaries"] : []),
      ...(checkBackend ? ["router-compile", "backend"] : []), ...(checkFrontend ? ["frontend", "build"] : [])] };
}
export function parseValidationArgs(args) {
  const options = { planOnly: false, staged: false, base: null, releasePlan: "backend-first", event: null, publish: null };
  const seen = new Set();
  for (const arg of args) {
    const key = arg.split("=")[0];
    if (seen.has(key)) throw Error("Duplicate validation option"); seen.add(key);
    if (arg === "--plan") options.planOnly = true;
    else if (arg === "--staged") options.staged = true;
    else if (arg.startsWith("--base=") && arg.slice(7) && !arg.slice(7).startsWith("-")) options.base = arg.slice(7);
    else if (arg.startsWith("--event=") && arg.slice(8)) options.event = arg.slice(8);
    else if (["--publish=frontend", "--publish=backend", "--publish=full"].includes(arg)) options.publish = arg.slice(10);
    else if (["--release-plan=backend-first", "--release-plan=frontend-only"].includes(arg)) options.releasePlan = arg.split("=")[1];
    else throw Error("Unknown validation option; forced downgrade is not supported");
  }
  if (options.staged && options.base) throw Error("Choose staged changes or a base commit");
  if (options.event && (options.staged || options.base || options.publish)) throw Error("CI event supplies the entire selection");
  if (options.publish && options.staged) throw Error("Publication requires a committed candidate");
  return options;
}

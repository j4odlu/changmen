/** [changmen 扩展] 日常检查和发布按范围离线验证；完整专项审计保留独立入口。 */
const controlPatterns = [
  /^scripts\/(?:verification|deploy)\//,
  /^\.github\//,
  /^sh\/(?:deploy-[^/]+\.sh|_common\.sh)$/,
  /^deploy\/release-(?:common|backend|frontend)\.sh$/,
];
const fullPatterns = [
  /^(?:package(?:-lock)?\.json|turbo\.json)$/,
  /^(?:packages\/|server\/db\/|server\/backend\/db\/)/,
  /^server\/backend\/core\/(?:account|auth|certificates|integrations|orderModes|esport-api|http)\//,
  /^server\/backend\/(?:http_routes\.js|server\.js|proxy\/|scripts\/)/,
  /^client\/web\/src\/(?:api|lib|stores|runtime|orderModes|services|models|types|domain)\//,
  /^client\/web\/src\/App(?:\.[^/]+)?\.(?:vue|ts)$/,
  /^client\/web\/src\/components\/(?:account|betting)\//,
  /^(?:scripts\/(?:verification|migrations|deploy)\/|deploy\/|\.github\/|chrome-extension\/|lines\/)/,
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
    if (fullPatterns.some(p => p.test(file))) { fullReasons.push(file); continue; }
    if (/^client\/web\//.test(file)) frontend = true;
    else if (/^server\/backend\/core\/observability\//.test(file) || /^server\/backend\/core\/shared\/runtime_version(?:\.test)?\.mjs$/.test(file) || file === "server/backend/core/shared/runtime_version.js" || /^server\/storage\/runtime_version\./.test(file)) backend = true;
    else fullReasons.push(file);
  }
  // 同时影响客户端和服务端的独立工具也不能冒充单端检查。
  if (relevant.some(p => /^server\/storage\/runtime_version\./.test(p))) { frontend = true; backend = true; }
  const full = fullReasons.length > 0 || !paths.length || forceTests;
  const testsNeeded = forceTests || !relevant.length || !relevant.every(file => controlPatterns.some(pattern => pattern.test(file))
    || /^deploy\/scripts\/release-(?:common|frontend|backend)\.sh$/.test(file));
  const tier = publication ? components.length === 2 ? "integration" : components[0]
    : full ? "full" : frontend && backend ? "integration" : frontend ? "frontend" : backend ? "backend" : controls ? "controls" : "docs";
  // 后端入口本身含 test:checks，避免再串联一次相同边界检查。
  const checkBackend = backend || full, checkFrontend = frontend || full;
  const verificationChanged = relevant.some(file => /^scripts\/verification\//.test(file));
  const releaseChecks = ["validation-control", ...(verificationChanged ? ["verification-control", "verification-node"] : [])];
  if (publication) {
    if (!components.includes("backend") || !testsNeeded) releaseChecks.push("boundaries");
    if (components.includes("backend")) releaseChecks.push("router-compile", ...(testsNeeded ? ["backend"] : []));
    if (components.includes("frontend")) releaseChecks.push(...(testsNeeded ? ["frontend"] : []), "build");
  }
  return { tier, paths, fullReasons, immutableFokEntries: release ? 0 : 551, snapshotOverridesAllowed: false,
    checks: release ? releaseChecks : ["fok-551", "validation-control",
      ...(controls || full ? ["verification-control", "verification-node"] : []),
      ...(checkFrontend && !checkBackend ? ["boundaries"] : []),
      ...(checkBackend ? ["router-compile", "backend"] : []), ...(checkFrontend ? ["frontend-typecheck", "frontend", "build"] : [])] };
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

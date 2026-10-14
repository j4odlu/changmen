/** [changmen 扩展] 验收范围只由真实改动决定；未知范围与交易核心一律完整验收。 */
const fullPatterns = [
  /^(?:package(?:-lock)?\.json|turbo\.json)$/,
  /^(?:packages\/|server\/db\/|server\/backend\/db\/)/,
  /^server\/backend\/core\/(?:account|auth|certificates|integrations|orderModes|esport-api|http)\//,
  /^server\/backend\/(?:http_routes\.js|server\.js|proxy\/|scripts\/)/,
  /^client\/web\/src\/(?:api|lib|stores|runtime|orderModes|services|models|types)\//,
  /^client\/web\/src\/components\/(?:account|betting)\//,
  /^(?:scripts\/(?:verification|migrations|deploy)\/|deploy\/|\.github\/|chrome-extension\/|lines\/)/,
];
function normalize(file) {
  const clean = file.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!clean || clean.startsWith("/") || clean.split("/").some(p => p === "..") || clean.includes("\0")) throw Error("Invalid changed path");
  return clean;
}
export function validationPlan(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.some(p => typeof p !== "string")) throw Error("Changed paths required");
  const paths = [...new Set(changedPaths.map(normalize))].sort();
  const relevant = paths.filter(p => !/\.md$/i.test(p) && !/^(?:docs\/|output\/|\.playwright-cli\/)/.test(p));
  let frontend = false, backend = false; const fullReasons = [];
  for (const file of relevant) {
    if (fullPatterns.some(p => p.test(file))) { fullReasons.push(file); continue; }
    if (/^client\/web\//.test(file)) frontend = true;
    else if (/^server\/backend\/core\/observability\//.test(file) || /^server\/backend\/core\/shared\/runtime_version(?:\.test)?\.mjs$/.test(file) || file === "server/backend/core/shared/runtime_version.js" || /^server\/storage\/runtime_version\./.test(file)) backend = true;
    else fullReasons.push(file);
  }
  // 同时影响客户端和服务端的独立工具也不能冒充单端检查。
  if (relevant.some(p => /^server\/storage\/runtime_version\./.test(p))) { frontend = true; backend = true; }
  const tier = fullReasons.length || !paths.length ? "full" : frontend && backend ? "integration" : frontend ? "frontend" : backend ? "backend" : "docs";
  return { tier, paths, fullReasons, immutableFokEntries: 551, snapshotOverridesAllowed: false,
    checks: tier === "full" ? ["validation-control", "complete-release"] : ["fok-551", "validation-control", ...(tier === "docs" ? [] : ["boundaries"]),
      ...(backend ? ["router-compile", "backend"] : []), ...(frontend ? ["frontend-typecheck", "frontend", "build"] : [])] };
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

/** [changmen 扩展] One plan combines validation risk with component publication dependencies. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validationPlan } from "../verification/validation-plan.mjs";
import { classifyDeployScope, isDatabaseMaintenancePath } from "./classify-deploy-scope.mjs";

export const planHash = plan => createHash("sha256").update(JSON.stringify(plan)).digest("hex");
// Preserve the standalone DB workflow's original push coverage in this one chain.
// Maintenance-only changes still need DB validation even when no app is published.
const databaseWorkflowPath = file => file === ".github/workflows/database-compatibility.yml"
  || /^(?:scripts\/(?:testing|deploy)\/|(?:rds|server\/db)\/|server\/backend\/db\/)/.test(file)
  || /^deploy\/scripts\/release-[^/]*\.sh$/.test(file)
  || /^server\/backend\/scripts\/[^/]*(?:rds|order-observation-schema)[^/]*$/.test(file)
  || /^package(?:-lock)?\.json$/.test(file);
export function changePlan(paths, { unknownBase = false, requestedScope = null, deployedVersions = null, liveComponents = null, eventPaths = null, purpose = requestedScope ? "release" : "change" } = {}) {
  if (requestedScope !== null && !["frontend", "backend", "full"].includes(requestedScope))
    throw Error("Invalid requested publication scope");
  if (!["change", "release"].includes(purpose)) throw Error("Invalid validation purpose");
  if (liveComponents !== null) {
    if (!deployedVersions || !["frontend", "backend"].every(role => /^[a-f0-9]{40}$/.test(deployedVersions[role] ?? "")))
      throw Error("Verified deployed versions required");
    if (!Array.isArray(liveComponents) || liveComponents.some(role => !["frontend", "backend"].includes(role)))
      throw Error("Invalid live component selection");
  }
  const liveScope = liveComponents === null ? null : liveComponents.length === 2 ? "full" : liveComponents[0] ?? "noop";
  const scope = requestedScope ?? (unknownBase ? "full" : liveScope ?? classifyDeployScope(paths));
  const components = scope === "full" ? ["backend", "frontend"] : scope === "noop" ? [] : [scope];
  // Shared runtime/API changes retain ordering; unrelated app changes are independent.
  const backendFirst = components.length === 2 && (unknownBase || requestedScope === "full" || paths.some(file =>
    !isDatabaseMaintenancePath(file) && (classifyDeployScope([file]) === "full"
      || /^(?:client\/web\/src\/api\/|server\/backend\/core\/esport-api\/|server\/backend\/http_routes\.js$)/.test(file))));
  const publication = purpose === "release" && components.length > 0;
  const validation = validationPlan(paths, { publication, components, release: purpose === "release",
    forceTests: unknownBase || requestedScope !== null });
  if (paths.some(file => /^(?:scripts\/deploy\/|\.github\/|deploy\/|sh\/(?:deploy-|_common\.sh))/.test(file)
    || /^scripts\/verification\/(?:validation-plan|verify-change)(?:\.test)?\.mjs$/.test(file)))
    validation.checks = ["deployment-control", ...validation.checks];
  // [changmen 扩展] Required checks verify the same committed candidate before sealing.
  // FOK/live historical auditing has its own explicit entry; ordinary releases run component checks.
  const uncertain = unknownBase || requestedScope !== null;
  const requiredChecks = {
    completeRelease: false,
    databaseCompatibility: (purpose === "release" && paths.some(databaseWorkflowPath))
      || (publication && (uncertain || components.includes("backend")
        || paths.some(file => isDatabaseMaintenancePath(file)
          || /^(?:(?:rds|server\/db)\/|server\/backend\/db\/|scripts\/testing\/|packages\/shared\/|package(?:-lock)?\.json$)/.test(file)))),
  };
  if (requiredChecks.databaseCompatibility) validation.checks.push("database-compatibility");
  return { ...validation, changedPaths: [...new Set(paths)].sort(), unknownBase, requestedScope, deployedVersions, liveComponents, eventPaths,
    purpose, requiredChecks, deployment: { scope, components, backendFirst }, releasePlan: components.length === 1 && components[0] === "frontend" ? "frontend-only" : "backend-first" };
}
export function deployedSelection(versions, root, head, eventPaths = []) {
  const paths = [...eventPaths], liveComponents = [];
  try {
    for (const role of ["backend", "frontend"]) {
      if (!/^[a-f0-9]{40}$/.test(versions?.[role] ?? "")) throw Error("Invalid deployed commit");
      const changed = execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", versions[role], head],
        { cwd: root, encoding: "utf8", windowsHide: true, stdio: "pipe" }).split("\0").filter(Boolean);
      const relevant = changed.filter(file => [role, "full"].includes(classifyDeployScope([file])));
      if (relevant.length) liveComponents.push(role);
      paths.push(...relevant);
    }
    return { paths: [...new Set(paths)].sort(), liveComponents, deployedVersions: versions, eventPaths, unknownBase: false };
  } catch { return { paths: [], liveComponents: null, deployedVersions: null, eventPaths, unknownBase: true }; }
}
export function eventSelection(event, root, expectedSha, versions = null) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  const head = git("rev-parse", "HEAD").trim();
  if (!/^[a-f0-9]{40}$/.test(expectedSha ?? "") || head !== expectedSha)
    throw Error("CI checkout does not match its event commit");
  if (event.inputs) return { paths: [], unknownBase: true, requestedScope: event.inputs.component ?? "full" };
  if (!/^[a-f0-9]{40}$/.test(event.before ?? "") || /^0+$/.test(event.before))
    return { paths: [], unknownBase: true, requestedScope: null };
  try {
    git("rev-parse", "--verify", `${event.before}^{commit}`);
    const paths = git("diff", "--no-renames", "--name-only", "-z", event.before, head).split("\0").filter(Boolean);
    return versions ? { ...deployedSelection(versions, root, head, paths), requestedScope: null }
      : { paths, unknownBase: false, requestedScope: null };
  } catch { return { paths: [], unknownBase: true, requestedScope: null }; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const versions = process.env.CI_DEPLOYED_VERSIONS_FILE ? JSON.parse(fs.readFileSync(process.env.CI_DEPLOYED_VERSIONS_FILE, "utf8")) : null;
  const selected = eventSelection(JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")), process.cwd(), process.env.GITHUB_SHA, versions);
  const plan = changePlan(selected.paths, { ...selected, purpose: "release" });
  fs.mkdirSync("output/change-validation", { recursive: true });
  fs.writeFileSync("output/change-validation/plan.json", JSON.stringify(plan, null, 2));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,
    `tier=${plan.tier}\nbackend=${plan.deployment.components.includes("backend")}\nfrontend=${plan.deployment.components.includes("frontend")}\nbackend-first=${plan.deployment.backendFirst}\ncomplete-release=${plan.requiredChecks.completeRelease}\ndatabase-compatibility=${plan.requiredChecks.databaseCompatibility}\n`);
  console.log(JSON.stringify(plan));
}

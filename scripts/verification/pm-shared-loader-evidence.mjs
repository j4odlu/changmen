// [changmen 扩展] Classify PM-reachable loader records without executing a loader or connecting to DB.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import ts from "typescript";

const digest = value => createHash("sha256").update(value).digest("hex");
const relative = (root, file) => path.relative(root, file).replaceAll("\\", "/");
const keyOf = site => JSON.stringify([site.file, site.kind, site.expression ?? null, site.loaderSymbol ?? null, site.arguments ?? null]);
const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));

/** Token contracts bind the reviewed interpretation; they do not replace any FOK source protection. */
export function sharedLoaderSourceSignature(file, source, selector = "module") {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  if (tree.parseDiagnostics.length) throw Error(`Cannot inspect shared loader contract: ${file}`);
  let selected = [tree];
  if (selector === "pg-loader") {
    selected = tree.statements.filter(node => ts.isImportDeclaration(node)
      || ts.isFunctionDeclaration(node) && node.name?.text === "requirePg"
      || ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && ["__dirname", "require"].includes(d.name.text)));
    if (selected.filter(node => ts.isFunctionDeclaration(node)).length !== 1
      || selected.filter(node => ts.isVariableStatement(node)).length !== 2) throw Error(`Incomplete PG loader contract: ${file}`);
  } else if (selector !== "module") throw Error(`Unknown source selector: ${selector}`);
  // The parsed token tree handles template substitutions and regular expressions contextually.
  // A standalone scanner can swallow the rest of a module as an unfinished template token.
  const tokens = [];
  function visit(node) {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (ts.isToken(node) && node.kind !== ts.SyntaxKind.EndOfFileToken) tokens.push([node.kind, node.getText(tree)]);
    else for (const child of node.getChildren(tree)) visit(child);
  }
  selected.forEach(visit);
  return digest(JSON.stringify(tokens));
}

function fileEvidence(root, file, allowedRoot = "") {
  const absolute = path.resolve(root, file), rel = relative(root, absolute);
  if (path.isAbsolute(rel) || rel === ".." || rel.startsWith("../") || allowedRoot && rel !== allowedRoot && !rel.startsWith(`${allowedRoot}/`)) throw Error(`Shared target escapes its declared root: ${file}`);
  const real = fs.realpathSync(absolute), realRel = relative(root, real);
  if (path.isAbsolute(realRel) || realRel === ".." || realRel.startsWith("../") || allowedRoot && realRel !== allowedRoot && !realRel.startsWith(`${allowedRoot}/`)) throw Error(`Shared target symlink escapes its declared root: ${file}`);
  if (!fs.statSync(real).isFile()) throw Error(`Shared target is not a file: ${file}`);
  return { file: rel, realFile: realRel, sha256: digest(fs.readFileSync(real)) };
}

export function inspectPmSharedLoaders(root, sites, { env = process.env, readSource = file => fs.readFileSync(path.join(root, file), "utf8"), policy } = {}) {
  policy ??= readJson(path.join(root, "scripts/verification/pm-shared-loader-inputs.json"));
  if (policy.schemaVersion !== 1 || policy.purpose !== "pm-shared-loader-review-only" || policy.publishScopeOptimizationEnabled !== false) throw Error("Shared loader evidence cannot change publish scope");
  if (!policy.sourceContracts?.length || !policy.records?.length || !policy.environmentPolicies?.length) throw Error("Incomplete shared loader evidence policy");
  const violations = [], sourceContracts = [], matched = new Set(), records = [];
  function reject(file, spec, pattern) { violations.push({ rule: "pm-shared-loader", file, line: 0, spec, pattern }); }
  for (const contract of policy.sourceContracts) {
    const actual = sharedLoaderSourceSignature(contract.file, readSource(contract.file), contract.selector);
    sourceContracts.push({ ...contract, actual, matched: actual === contract.signature });
    if (actual !== contract.signature) reject(contract.file, contract.selector, "shared loader interpretation changed; review target/root evidence before accepting classifications");
  }
  const contractsMatch = sourceContracts.every(row => row.matched);
  const allowedCategories = new Set(["fixed-target", "environment-dependent", "parameter-unknown"]);
  const registrations = new Map(), ids = new Set();
  for (const row of policy.records) {
    const key = keyOf(row);
    if (!row.id || ids.has(row.id) || registrations.has(key) || !allowedCategories.has(row.classification)) throw Error("Invalid shared loader registration");
    if (row.target?.request && JSON.stringify(row.target.request) !== JSON.stringify(row.arguments)) throw Error("Shared target request must match its source arguments");
    ids.add(row.id);
    registrations.set(key, row);
  }
  for (const site of sites) {
    const key = keyOf(site), row = registrations.get(key);
    if (!row || matched.has(key)) {
      reject(site.file, site.expression || site.kind, "new, changed or duplicated PM-reachable shared loader input requires review");
      records.push({ ...site, classification: "unreviewed", closed: false });
      continue;
    }
    matched.add(key);
    records.push({ ...site, id: row.id, classification: contractsMatch ? row.classification : "unreviewed", targetNameDetermined: contractsMatch && row.classification === "fixed-target",
      rootPolicy: row.rootPolicy, target: row.target, scopeInterpretation: row.scopeInterpretation, closed: false });
  }
  for (const [key, row] of registrations) if (!matched.has(key)) reject(row.file, row.expression || row.kind, "reviewed shared loader record disappeared; reconcile the evidence instead of silently dropping it");

  const environmentPolicies = policy.environmentPolicies.map(row => ({ ...row,
    processConfiguredKeys: row.keys.filter(key => typeof env[key] === "string" && env[key].length > 0),
    externalContentsInspected: false,
  }));
  let defaultScenario;
  if (contractsMatch && violations.length === 0) {
    const manifest = readJson(path.join(root, "server/venues/registry/runtime/registry/manifest.json"));
    const targetEvidence = [], targetKeys = new Set();
    const addTarget = (file, allowedRoot) => {
      if (!targetKeys.has(file)) { targetKeys.add(file); targetEvidence.push(fileEvidence(root, file, allowedRoot)); }
      return file;
    };
    for (const record of records.filter(row => row.target?.request)) {
      const args = record.target.request;
      if (record.loaderSymbol === "adapterRequire") addTarget(`server/venues/registry/runtime/${args.join("/")}`, "server/venues/registry/runtime/registry");
      else if (record.loaderSymbol === "requirePlatform") {
        const entry = manifest.find(row => row.id.toLowerCase() === args[0].toLowerCase());
        if (!entry || !/^[a-zA-Z0-9_-]+$/.test(entry.dir) || !["node", "backend"].includes(args[1])) throw Error(`Unreviewed platform target: ${args.join("/")}`);
        addTarget(`server/platform-probes/${entry.dir}/${args.slice(2).join("/")}`, "server/platform-probes");
      }
    }
    for (const file of ["server/venues/registry/runtime/registry/paths.js", "server/venues/registry/runtime/registry/feeds.js"]) addTarget(file, "server/venues/registry/runtime/registry");
    // Enumerate exactly the runtime's top-level ESM file rule; never import files or descend into scripts/.
    const preloadFiles = [], preloadPackages = [];
    for (const entry of manifest) {
      if (!/^[a-zA-Z0-9_-]+$/.test(entry.dir)) throw Error(`Unsafe manifest directory: ${entry.dir}`);
      const dir = `server/platform-probes/${entry.dir}`, pkg = `${dir}/package.json`;
      if (!fs.existsSync(path.join(root, pkg))) continue;
      const evidence = fileEvidence(root, pkg, "server/platform-probes");
      let data;
      try { data = readJson(path.join(root, pkg)); } catch { throw Error(`Uninspectable preload package: ${pkg}`); }
      preloadPackages.push({ ...evidence, module: data.type === "module" });
      if (data.type !== "module") continue;
      for (const file of fs.readdirSync(path.join(root, dir)).sort()) if (file.endsWith(".js") && !file.startsWith("_") && fs.statSync(path.join(root, dir, file)).isFile()) preloadFiles.push(fileEvidence(root, `${dir}/${file}`, "server/platform-probes"));
    }
    const searchPaths = ["apps/backend/node_modules", "node_modules", "server/node_modules"];
    const pg = createRequire(path.join(root, "rds/pg_pool.js")).resolve("pg", { paths: searchPaths.map(file => path.join(root, file)) });
    const pgEvidence = fileEvidence(root, relative(root, pg));
    const lock = readJson(path.join(root, "package-lock.json"));
    let dir = path.dirname(pg), pgPackage;
    while (dir !== path.dirname(dir) && !relative(root, dir).startsWith("../") && !path.isAbsolute(relative(root, dir))) {
      const file = path.join(dir, "package.json");
      if (fs.existsSync(file) && readJson(file).name === "pg") { pgPackage = readJson(file); break; }
      dir = path.dirname(dir);
    }
    if (!pgPackage || lock.packages?.[relative(root, dir)]?.version !== pgPackage.version) throw Error("PG resolved package does not match its lock record");
    defaultScenario = {
      assumption: "workspace default roots; no environment/programmatic override; current installation",
      applicableToAuditorProcess: environmentPolicies.every(row => row.processConfiguredKeys.length === 0),
      manifest: fileEvidence(root, "server/venues/registry/runtime/registry/manifest.json"), targetEvidence, preloadPackages, preloadFiles,
      pg: { ...pgEvidence, version: pgPackage.version, lockKey: relative(root, dir), searchPaths, ancestorSearch: true },
      runtimeExecuted: false, moduleDependencyClosuresCertified: false,
      recognizedRequests: {
        requirePlatform: sites.filter(site => site.kind === "custom-loader" && site.loaderSymbol === "requirePlatform").length,
        adapterRequireRegistryFastPath: sites.filter(site => site.kind === "custom-loader" && site.loaderSymbol === "adapterRequire" && site.arguments?.[0] === "registry" && ["paths.js", "feeds.js"].includes(site.arguments?.[1]) && site.arguments.length === 2).length,
        reqS: sites.filter(site => site.kind === "custom-loader" && site.loaderSymbol === "reqS").length,
        backendRequire: sites.filter(site => site.kind === "custom-loader" && site.loaderSymbol === "backendRequire").length,
        adapterRequireGeneric: sites.filter(site => site.kind === "custom-loader" && site.loaderSymbol === "adapterRequire" && !(site.arguments?.[0] === "registry" && ["paths.js", "feeds.js"].includes(site.arguments?.[1]) && site.arguments.length === 2)).length,
      },
    };
  }
  const byClass = Object.fromEntries([...allowedCategories].map(category => [category, records.filter(row => row.classification === category).length]));
  return { schemaVersion: 1, sourceContracts, records, byClass, environmentPolicies, defaultScenario,
    environmentSource: "auditor process only; application .env and remote environment are not loaded",
    runtimeRootsCertified: false, safeToNarrowPublishScope: false, publishScopeOptimizationEnabled: false,
    limitations: ["Fixed relative names may still have overridden roots; classification does not certify an absolute production target.",
      "Parameter ports remain genuinely open APIs; current recognized PM call sites do not invoke reqS/backendRequire or adapterRequire's generic branch.",
      "Only directly requested files and manifest-selected top-level module names/hashes are read; no historical script recursion or application execution."],
    violations };
}

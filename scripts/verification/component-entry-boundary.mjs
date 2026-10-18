// [changmen 扩展] Read source only: never import application modules or choose a publish scope.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import ts from "typescript";
import { validateSourceOwnership, sourceLayerViolation } from "./source-ownership.mjs";

const SOURCE = /\.(?:[cm]?[jt]sx?|vue)$/;
const SKIP = new Set(["node_modules", "dist", "coverage", "platform_adapter", "platform_node"]);
const testFile = file => /(?:^|\/)(?:tests?|__tests__|fixtures)(?:\/|$)|\.(?:test|spec)\.[^/]+$/.test(file);
const under = (file, prefix) => file === prefix || file.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);

export function componentImportSites(file, source, customLoaders = []) {
  // Keep Vue offsets/line numbers intact; templates/styles are not JavaScript.
  if (file.endsWith(".vue")) {
    const spans = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/g)]
      .map(match => [match.index + match[0].indexOf(">") + 1, match[1]]);
    const original = source;
    source = source.replace(/[^\r\n]/g, " ");
    for (const [offset, script] of spans) source = source.slice(0, offset) + original.slice(offset, offset + script.length) + source.slice(offset + script.length);
  }
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const sites = [], loaders = new Set(["require", ...customLoaders]), custom = new Set(customLoaders), factories = new Set();
  const customOrigins = new Map(customLoaders.map(name => [name, name]));
  const literal = node => node && ts.isStringLiteralLike(node) ? node.text : null;
  function record(node, argument, kind) {
    sites.push({ file, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
      kind, spec: literal(argument), expression: argument?.getText(tree) ?? "<missing>",
      ...(ts.isCallExpression(node) ? { loader: node.expression.getText(tree), loaderSymbol: customOrigins.get(node.expression.getText(tree)), arguments: node.arguments.map(literal) } : {}) });
  }
  // Alias discovery is separate so a call before a function/alias declaration is still inspected.
  function aliases(node) {
    if (ts.isImportDeclaration(node)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
        const imported = (binding.propertyName || binding.name).text;
        if (["node:module", "module"].includes(literal(node.moduleSpecifier)) && imported === "createRequire") factories.add(binding.name.text);
        if (loaders.has(imported)) loaders.add(binding.name.text);
        if (custom.has(imported)) { custom.add(binding.name.text); customOrigins.set(binding.name.text, customOrigins.get(imported)); }
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const value = node.initializer;
      if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && factories.has(value.expression.text)
        || ts.isIdentifier(value) && loaders.has(value.text)) loaders.add(node.name.text);
      if (ts.isIdentifier(value) && custom.has(value.text)) { custom.add(node.name.text); customOrigins.set(node.name.text, customOrigins.get(value.text)); }
    }
    ts.forEachChild(node, aliases);
  }
  let previousSize = -1;
  while (previousSize !== loaders.size + factories.size + custom.size) {
    previousSize = loaders.size + factories.size + custom.size;
    aliases(tree);
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) record(node, node.moduleSpecifier, node.isTypeOnly || node.importClause?.isTypeOnly ? "type" : "static");
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) record(node, node.moduleReference.expression, "require");
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) record(node, node.argument.literal, "type");
    else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) record(node, node.arguments[0], "dynamic-import");
      else if (ts.isIdentifier(callee) && loaders.has(callee.text)) record(node, node.arguments[0], custom.has(callee.text) ? "custom-loader" : "require");
      else if (callee.getText(tree) === "module.require") record(node, node.arguments[0], "require");
      else if (ts.isPropertyAccessExpression(callee) && (callee.name.text === "resolve" && loaders.has(callee.expression.getText(tree))
        || callee.expression.getText(tree) === "import.meta" && ["glob", "globEager", "resolve"].includes(callee.name.text))) record(node, node.arguments[0], "computed-loader");
    } else if (ts.isNewExpression(node) && node.expression.getText(tree) === "URL" && node.arguments?.[1]?.getText(tree) === "import.meta.url") record(node, node.arguments[0], "module-url");
    ts.forEachChild(node, visit);
  }
  visit(tree);
  // Existing operational scripts can contain syntax errors: keep recovered edges,
  // explicitly record incomplete analysis, and never certify a smaller scope.
  for (const diagnostic of tree.parseDiagnostics) sites.push({ file,
    line: tree.getLineAndCharacterOfPosition(diagnostic.start || 0).line + 1,
    kind: "parse-error", spec: null, expression: ts.flattenDiagnosticMessageText(diagnostic.messageText, " ") });
  return sites;
}

/** A fresh read-only snapshot for one audit invocation, never a process/global cache. */
export function createComponentInspection(root) {
  root = fs.realpathSync(root);
  const memo = operation => {
    const values = new Map();
    return key => {
      if (!values.has(key)) values.set(key, operation(key));
      return values.get(key);
    };
  };
  const snapshot = {
    exists: memo(file => fs.existsSync(file)),
    realpath: memo(file => fs.realpathSync(file)),
    stat: memo(file => fs.statSync(file)),
    read: memo(file => fs.readFileSync(file, "utf8")),
    directory: memo(file => fs.readdirSync(file, { withFileTypes: true })),
    safe: new Map(), walks: new Map(), files: new Map(), imports: new Map(), resolutions: new Map(),
  };
  return {
    inspect: (manifest, options = {}) => inspectComponentSnapshot(root,
      manifest === undefined ? JSON.parse(snapshot.read(path.join(root, "scripts/deploy/component-inputs.json"))) : manifest, options, snapshot),
    readSource: file => snapshot.read(path.join(root, file)),
  };
}

export function inspectComponentEntries(root, manifest, options = {}) {
  return createComponentInspection(root).inspect(manifest, options);
}

function inspectComponentSnapshot(root, manifest, { scope }, snapshot) {
  const violations = [], unknown = [], sourceCache = new Map(), resolutionCache = snapshot.resolutions;
  const violation = (file, spec, pattern, line = 0) => violations.push({ rule: "component-entry", file, line, spec, pattern });
  const clean = file => typeof file === "string" && file.length > 0 && !file.includes("\\") && !path.posix.isAbsolute(file)
    && !/^[a-z]:/i.test(file) && !file.split("/").some(part => part === ".." || part === ".");
  function safe(file) {
    if (!clean(file)) throw Error(`Invalid component path: ${file}`);
    if (snapshot.safe.has(file)) return snapshot.safe.get(file);
    const abs = path.join(root, file);
    if (snapshot.exists(abs)) {
      const relative = path.relative(root, snapshot.realpath(abs));
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error(`Component path escapes workspace: ${file}`);
    }
    snapshot.safe.set(file, abs); return abs;
  }
  function walk(rel) {
    if (snapshot.walks.has(rel)) return snapshot.walks.get(rel);
    const abs = safe(rel);
    if (!snapshot.exists(abs)) throw Error(`Missing component input: ${rel}`);
    if (snapshot.stat(abs).isFile()) return SOURCE.test(rel) ? [rel] : [];
    const files = snapshot.directory(abs).slice().sort((a, b) => a.name.localeCompare(b.name)).flatMap(item =>
      item.name.startsWith(".") || SKIP.has(item.name) || item.isSymbolicLink() ? [] : walk(`${rel.replace(/\/$/, "")}/${item.name}`));
    snapshot.walks.set(rel, files); return files;
  }
  if (manifest.schemaVersion !== 1 || manifest.purpose !== "inventory-and-boundary-only" || manifest.publishScopeOptimizationEnabled !== false) throw Error("Component inventory cannot enable publish scope optimization");
  const selectedScope = scope ? manifest.scopes?.[scope] : undefined;
  const ownership = manifest.sourceOwnership
    ? validateSourceOwnership(JSON.parse(snapshot.read(safe(manifest.sourceOwnership), "utf8"))) : null;
  if (scope && !selectedScope) throw Error(`Unknown component scope: ${scope}`);
  const ids = new Set(), entryFiles = new Set();
  for (const entry of manifest.entries) {
    if (!entry.id || ids.has(entry.id) || entryFiles.has(entry.file) || !["browser", "node", "universal"].includes(entry.environment)) throw Error(`Invalid/duplicate component entry: ${entry.id}`);
    ids.add(entry.id); entryFiles.add(entry.file);
    if (!snapshot.exists(safe(entry.file))) throw Error(`Missing component entry: ${entry.file}`);
  }
  for (const prefix of [...manifest.nodeRoots, ...manifest.nodeOnlyPaths, ...manifest.browserRoots, ...manifest.browserOnlyPaths]) {
    if (!snapshot.exists(safe(prefix))) throw Error(`Missing component root: ${prefix}`);
  }
  for (const file of manifest.testEntries) if (!snapshot.exists(safe(file))) throw Error(`Missing test entry: ${file}`);
  for (const file of manifest.conservativeInputs) if (!snapshot.exists(safe(file))) throw Error(`Missing conservative input: ${file}`);
  for (const item of manifest.isolatedBrowserRoots || []) if (!snapshot.exists(safe(item.path)) || !Array.isArray(item.typeImports)) throw Error(`Invalid isolated browser root: ${item.path}`);

  const packages = new Map(), rootPackage = JSON.parse(snapshot.read(path.join(root, "package.json"), "utf8"));
  for (const pattern of rootPackage.workspaces) {
    const star = pattern.indexOf("*");
    if (star >= 0 && !pattern.endsWith("/*")) throw Error(`Unsupported workspace pattern: ${pattern}`);
    const dirs = star < 0 ? [pattern] : snapshot.directory(safe(pattern.slice(0, -2)))
      .filter(item => item.isDirectory()).map(item => `${pattern.slice(0, -1)}${item.name}`);
    for (const dir of dirs) {
      const file = `${dir}/package.json`;
      if (!snapshot.exists(safe(file))) continue;
      const pkg = JSON.parse(snapshot.read(safe(file), "utf8"));
      if (packages.has(pkg.name)) throw Error(`Duplicate workspace name: ${pkg.name}`);
      packages.set(pkg.name, { dir, ...pkg });
    }
  }
  const externalNames = new Set([...builtinModules, ...[rootPackage, ...packages.values()].flatMap(pkg =>
    ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap(field => Object.keys(pkg[field] || {})))]);
  function resolveFile(file) {
    if (snapshot.files.has(file)) return snapshot.files.get(file);
    if (file === "." || file === "./") return [];
    const candidates = [file];
    // TS source can stand behind a .js import in Vite/tsc; inspect both conservatively.
    if (/\.[cm]?js$/.test(file)) candidates.push(file.replace(/\.[cm]?js$/, ".ts"), file.replace(/\.[cm]?js$/, ".mts"));
    // A dotted basename (marketData.worker, foo.impl) can still omit its source extension.
    if (!SOURCE.test(file) && !file.endsWith(".json")) for (const ext of [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".vue", ".json", "/index.js", "/index.ts", "/index.mjs"]) candidates.push(file + ext);
    const files = candidates.filter(candidate => snapshot.exists(safe(candidate)) && snapshot.stat(safe(candidate)).isFile());
    snapshot.files.set(file, files); return files;
  }
  const flattenTargets = target => typeof target === "string" ? [target] : target && typeof target === "object" ? Object.values(target).flatMap(flattenTargets) : [];
  function resolve(file, raw) {
    const key = `${file}\0${raw}`;
    if (resolutionCache.has(key)) return resolutionCache.get(key);
    // Query flags are Vite inputs; inspect their underlying source as well.
    const spec = raw.startsWith("#") ? raw : raw.replace(/[?#].*$/, "");
    let targets = [], unresolved = false;
    if (spec.startsWith(".")) targets = resolveFile(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)));
    else if (spec.startsWith("@/")) targets = resolveFile(`client/web/src/${spec.slice(2)}`);
    else if (spec.startsWith("node:")) return { targets: [], external: true };
    else {
      const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      const pkg = packages.get(name);
      if (!pkg) return { targets: [], external: externalNames.has(name), unresolved: !externalNames.has(name) };
      const subpath = spec === name ? "." : `.${spec.slice(name.length)}`;
      let target = typeof pkg.exports === "string" ? subpath === "." ? pkg.exports : undefined : pkg.exports?.[subpath];
      if (target === undefined && pkg.exports && subpath === "." && !Object.keys(pkg.exports).some(key => key.startsWith("."))) target = pkg.exports;
      if (target === undefined && pkg.exports) for (const [pattern, value] of Object.entries(pkg.exports)) {
        if (!pattern.includes("*")) continue;
        const [head, tail] = pattern.split("*");
        if (subpath.startsWith(head) && subpath.endsWith(tail)) target = flattenTargets(value).map(item => item.replaceAll("*", subpath.slice(head.length, tail ? -tail.length : undefined)));
      }
      if (target !== undefined) targets = flattenTargets(target).flatMap(item => resolveFile(path.posix.normalize(`${pkg.dir}/${item}`)));
      // Browser TS/Vite aliases also permit source subpaths omitted from Node exports.
      // Include them as possible edges, but mark incomplete exports resolution as unknown.
      else {
        targets = resolveFile(`${pkg.dir}/${subpath === "." ? pkg.main || "index" : subpath.slice(2)}`);
        unresolved = Boolean(pkg.exports);
      }
    }
    const result = { targets: [...new Set(targets)], unresolved: unresolved || targets.length === 0 };
    resolutionCache.set(key, result);
    return result;
  }
  for (const entry of manifest.entries) for (const spec of entry.specifiers || []) {
    const resolved = resolve("package.json", spec);
    if (resolved.unresolved || resolved.targets.length !== 1 || resolved.targets[0] !== entry.file) violation(entry.file, spec, `public export must still resolve exactly to ${entry.file}`);
  }
  const customLoaders = manifest.dynamicLoaders.flatMap(item => item.symbols);
  for (const loader of manifest.dynamicLoaders) {
    if (loader.status !== "opaque" || !loader.reason) throw Error(`Dynamic loader requires opaque status and reason: ${loader.file}`);
    for (const file of [loader.file, ...loader.inputs]) if (!snapshot.exists(safe(file))) throw Error(`Missing loader input: ${file}`);
    unknown.push({ file: loader.file, line: 0, kind: "loader-contract", reason: loader.reason, inputs: loader.inputs });
  }
  const browserPaths = [...manifest.browserRoots, ...manifest.browserOnlyPaths, ...manifest.entries.filter(item => item.environment === "browser").map(item => item.file)];
  const browserOnly = file => browserPaths.some(prefix => under(file, prefix));
  for (const entry of manifest.entries) if (entry.environment !== "browser" && browserOnly(entry.file)) violation(entry.file, entry.id, "conflicting browser/Node or universal environment");
  function sites(file) {
    if (!sourceCache.has(file)) {
      const key = JSON.stringify([file, customLoaders]);
      if (!snapshot.imports.has(key)) snapshot.imports.set(key, componentImportSites(file, snapshot.read(safe(file)), customLoaders));
      sourceCache.set(file, snapshot.imports.get(key));
    }
    return sourceCache.get(file);
  }
  // All Node source files are seeds (including operational scripts), except tests as seeds.
  // If production imports a test, it is traversed normally; test naming is no escape hatch.
  const isTest = file => testFile(file) || manifest.testEntries.includes(file);
  const nodeSeeds = new Set(selectedScope ? selectedScope.nodeRoots.flatMap(walk).filter(file => !isTest(file))
    : [...manifest.nodeRoots.flatMap(walk).filter(file => !isTest(file)), ...manifest.nodeOnlyPaths.flatMap(walk), ...manifest.entries.filter(item => item.environment !== "browser").map(item => item.file)]);
  const browserSeeds = new Set(selectedScope ? selectedScope.browserRoots.flatMap(walk).filter(file => !isTest(file))
    : [...manifest.browserRoots.flatMap(walk).filter(file => !isTest(file)), ...manifest.entries.filter(item => item.environment !== "node").map(item => item.file)]);
  const nodePaths = [...manifest.nodeRoots, ...manifest.nodeOnlyPaths, ...manifest.entries.filter(item => item.environment === "node").map(item => item.file)];
  const edges = [], unknownKeys = new Set(), dependencies = [];
  function traverse(seeds, environment, forbidden) {
    const queue = [...seeds].map(file => ({ file, trace: [] })), visited = new Set();
    for (let i = 0; i < queue.length; i++) {
      const { file, trace } = queue[i];
      if (visited.has(file)) continue;
      visited.add(file);
      if (forbidden(file)) {
        violation(file, "<source entry>", `conflicting ${environment} source root/environment`);
        continue;
      }
      for (const site of sites(file)) {
        const incomplete = site.spec === null || ["custom-loader", "computed-loader"].includes(site.kind);
        const resolution = site.spec === null || site.kind === "custom-loader" ? { targets: [] } : resolve(file, site.spec);
        const isolated = (manifest.isolatedBrowserRoots || []).find(item => under(file, item.path));
        if (isolated && (incomplete || resolution.unresolved || resolution.targets.some(target => !under(target, isolated.path))
          || !resolution.targets.length && !(site.kind === "type" && isolated.typeImports.includes(site.spec)))) {
          violation(file, site.spec, `isolated browser core cannot depend on host/platform/runtime input outside ${isolated.path}`, site.line);
        }
        if (selectedScope) dependencies.push({ ...site, environment, ...resolution });
        if (incomplete || resolution.unresolved) {
          const key = `${file}:${site.line}:${site.expression}`;
          if (!unknownKeys.has(key)) {
            unknownKeys.add(key);
            unknown.push({ ...site, environment, reason: site.kind === "parse-error" ? "syntax error prevents complete dependency inspection" : incomplete ? "computed/custom module loading requires review" : "unresolved module/alias/input", trace });
          }
        }
        for (const target of resolution.targets) {
          const edge = { ...site, target };
          const layerViolation = ownership && sourceLayerViolation(file, target, ownership);
          if (layerViolation) violations.push({ rule: "source-ownership", file, line: site.line, spec: site.spec, pattern: layerViolation, trace: [...trace, edge] });
          if (environment === "node") edges.push(edge);
          if (forbidden(target)) {
            violations.push({ rule: "component-entry", file, line: site.line, spec: site.spec,
              pattern: `${environment} source reaches ${environment === "node" ? "browser" : "node"}-only ${target}`, trace: [...trace, edge] });
          } else if (SOURCE.test(target)) queue.push({ file: target, trace: [...trace, edge] });
        }
      }
    }
    return visited;
  }
  const visited = traverse(nodeSeeds, "node", browserOnly);
  const browserVisited = traverse(browserSeeds, "browser", file => nodePaths.some(prefix => under(file, prefix)));
  // Explicitly scoped maintenance tools use Node APIs but retain their source owner.
  // Do not broaden this to unrelated historical scripts.
  if (!selectedScope && ownership?.toolingRoots) traverse(ownership.toolingRoots.flatMap(walk).filter(file => !isTest(file)), "tooling", () => false);
  const inventoryFiles = new Set(selectedScope ? sourceCache.keys() : [...sourceCache.keys(), ...manifest.nodeRoots.flatMap(walk), ...manifest.browserRoots.flatMap(walk), ...[...packages.values()].filter(pkg => pkg.dir.startsWith("packages/")).flatMap(pkg => walk(pkg.dir))]);
  const consumers = new Map(manifest.entries.map(entry => [entry.file, []]));
  for (const file of inventoryFiles) for (const site of sites(file)) {
    if (site.spec === null || site.kind === "custom-loader") continue;
    for (const target of resolve(file, site.spec).targets) if (consumers.has(target)) consumers.get(target).push({ ...site,
      usage: visited.has(file) ? "node-source" : browserVisited.has(file) ? "browser-source" : isTest(file) ? "test" : "shared-or-tooling-source" });
  }
  return {
    schemaVersion: 1, purpose: manifest.purpose, publishScopeOptimizationEnabled: false,
    ...(selectedScope ? { scope, sourceFiles: [...inventoryFiles].sort(), dependencies } : {}),
    conservativeInputs: manifest.conservativeInputs,
    // Batch A never issues a frontend-only certificate, even if all static edges pass.
    safeToNarrowPublishScope: false,
    limitations: ["Current tree and workspace source imports only; external dependencies, installation/build effects and previous deployed trees are not certified.", "Opaque loaders, computed paths, JSON configuration and custom aliases require review; existing conservative deploy classification remains authoritative."],
    nodeSourceFiles: visited.size, browserSourceFiles: browserVisited.size, staticNodeEdges: edges.length, scannedSourceFiles: sourceCache.size,
    entries: manifest.entries.map(entry => ({ ...entry, consumers: consumers.get(entry.file) })),
    unknown, violations,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const scopeIndex = process.argv.indexOf("--scope");
  if (scopeIndex !== -1 && (!process.argv[scopeIndex + 1] || process.argv[scopeIndex + 1].startsWith("--"))) throw Error("--scope requires a component name");
  const report = inspectComponentEntries(fileURLToPath(new URL("../../", import.meta.url)), undefined,
    scopeIndex === -1 ? {} : { scope: process.argv[scopeIndex + 1] });
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`component-entry: ${report.entries.length} entries, ${report.nodeSourceFiles} Node source files, ${report.unknown.length} unknown inputs; publish scope unchanged`);
    for (const v of report.violations) console.error(`${v.file}:${v.line}: ${v.pattern}\n${JSON.stringify(v.trace || [])}`);
  }
  if (report.violations.length) process.exitCode = 1;
}

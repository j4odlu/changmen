// [changmen 扩展] Source-only capability binding. No inspected module is imported or emitted.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import { inspectComponentEntries } from "./component-entry-boundary.mjs";
import { sharedLoaderSourceSignature } from "./pm-shared-loader-evidence.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const literal = node => node && ts.isStringLiteralLike(node) ? node.text : null;
const callKey = row => JSON.stringify([row.file, row.origin.file, row.origin.symbol, row.arguments]);
const originKey = row => `${row.file}#${row.symbol}`;
const empty = () => new Set();
const union = (...sets) => new Set(sets.flatMap(set => [...set]));
const modifiers = node => node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
function vueScript(source) {
  let masked = source.replace(/[^\r\n]/g, " ");
  for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/g)) {
    const start = match.index + match[0].indexOf(">") + 1;
    masked = masked.slice(0, start) + match[1] + masked.slice(start + match[1].length);
  }
  return masked;
}

/** Finite immutable aliases and explicit module exports; unsupported capability flows fail closed. */
export function analyzePmLoaderBindings({ files, dependencies, origins, expectedCalls, facade, reviewedAcquisition = () => false }) {
  const violations = [], calls = [], trees = new Map(), values = new Map(), exports = new Map(), cjs = new Map();
  const modules = new Map(), exportNames = new Map(), typeSymbols = new Set(), unknownKeys = new Set();
  const options = { allowJs: true, noEmit: true, noLib: true, allowNonTsExtensions: true, target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext };
  const virtualRoot = path.resolve("/__pm_loader_source__");
  const absolute = file => path.join(virtualRoot, file);
  const names = new Map(Object.keys(files).map(file => [absolute(file), file]));
  const host = ts.createCompilerHost(options);
  host.fileExists = file => names.has(path.resolve(file));
  host.readFile = file => files[names.get(path.resolve(file))];
  host.getSourceFile = (file, target) => {
    const rel = names.get(path.resolve(file));
    if (!rel) return undefined;
    const tree = ts.createSourceFile(file, rel.endsWith(".vue") ? vueScript(files[rel]) : files[rel], target, true,
      /\.[cm]?js$/.test(rel) ? ts.ScriptKind.JS : rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    trees.set(rel, tree); return tree;
  };
  // Bind lexical symbols only. Module capability edges are explicitly supplied below.
  host.resolveModuleNames = names => names.map(() => undefined);
  const program = ts.createProgram([...names.keys()], options, host), checker = program.getTypeChecker();
  const fileOf = node => names.get(path.resolve(node.getSourceFile().fileName));
  function reject(node, pattern, rule = "pm-loader-unknown") {
    const file = fileOf(node), line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const key = `${rule}:${file}:${node.pos}:${pattern}`;
    if (!unknownKeys.has(key)) { unknownKeys.add(key); violations.push({ rule, file, line, spec: node.getText().slice(0, 160), pattern }); }
  }
  for (const edge of dependencies) if (edge.spec && edge.targets?.length) {
    const key = `${edge.file}\0${edge.spec}`;
    modules.set(key, union(modules.get(key) || empty(), new Set(edge.targets.filter(file => Object.hasOwn(files, file)))));
  }
  for (const [file, tree] of trees) {
    exports.set(file, new Map()); exportNames.set(file, new Set());
    for (const diagnostic of tree.parseDiagnostics) reject(tree, ts.flattenDiagnosticMessageText(diagnostic.messageText, " "), "pm-loader-syntax");
  }
  const symbol = node => ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
  function add(map, key, value) {
    if (!key || !value.size) return false;
    const previous = map.get(key) || empty(), next = union(previous, value);
    if (next.size === previous.size) return false;
    map.set(key, next); return true;
  }
  const registered = new Map();
  for (const origin of origins) {
    const key = originKey(origin), tree = trees.get(origin.file);
    if (registered.has(key)) throw Error(`Duplicate loader origin: ${key}`);
    registered.set(key, origin);
    const matches = tree?.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === origin.symbol) || [];
    if (matches.length !== 1) { violations.push({ rule: "pm-loader-origin", file: origin.file, line: 0, spec: origin.symbol, pattern: "reviewed loader must remain one real top-level function definition" }); continue; }
    values.set(symbol(matches[0].name), new Set([`fn:${key}`]));
  }
  const isGlobal = (node, name) => {
    if (!ts.isIdentifier(node) || node.text !== name) return false;
    const declarations = symbol(node)?.declarations;
    // TS creates synthetic CJS symbols whose declarations are identifier uses, not bindings.
    return !declarations?.length || declarations.every(d => ts.isIdentifier(d) && d.text === name
      || name === "exports" && ts.isPropertyAccessExpression(d) && ts.isIdentifier(d.expression) && d.expression.text === "exports"
      || ts.isBinaryExpression(d) && ts.isPropertyAccessExpression(d.left) && ts.isIdentifier(d.left.expression)
        && d.left.expression.text === name && (name === "exports" || name === "module" && d.left.name.text === "exports"));
  };
  const moduleExports = node => ts.isPropertyAccessExpression(node) && isGlobal(node.expression, "module") && node.name.text === "exports";
  function exportName(node) {
    if (ts.isPropertyAccessExpression(node) && (isGlobal(node.expression, "exports") || moduleExports(node.expression))) return node.name.text;
    if (ts.isElementAccessExpression(node) && (isGlobal(node.expression, "exports") || moduleExports(node.expression))) return literal(node.argumentExpression);
    return null;
  }
  // Remember non-loader exports too, so metadata reads are distinct from missing members.
  for (const [file, tree] of trees) {
    function visit(node) {
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && modifiers(node)) exportNames.get(file).add(node.modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) ? "default" : node.name?.text);
      if (ts.isVariableStatement(node) && modifiers(node)) for (const d of node.declarationList.declarations) if (ts.isIdentifier(d.name)) exportNames.get(file).add(d.name.text);
      if (ts.isExportAssignment(node)) exportNames.get(file).add("default");
      if (ts.isExportDeclaration(node) && node.exportClause) {
        if (ts.isNamedExports(node.exportClause)) node.exportClause.elements.forEach(e => exportNames.get(file).add(e.name.text));
        else if (ts.isNamespaceExport(node.exportClause)) exportNames.get(file).add(node.exportClause.name.text);
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const name = exportName(node.left);
        if (name !== null) exportNames.get(file).add(name);
        if (moduleExports(node.left) && ts.isObjectLiteralExpression(node.right)) for (const p of node.right.properties) if (p.name) exportNames.get(file).add(ts.isIdentifier(p.name) ? p.name.text : literal(p.name));
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  let namesChanged = true;
  while (namesChanged) {
    namesChanged = false;
    for (const [file, tree] of trees) for (const node of tree.statements) if (ts.isExportDeclaration(node) && !node.exportClause && node.moduleSpecifier) {
      for (const target of modules.get(`${file}\0${literal(node.moduleSpecifier)}`) || []) for (const name of exportNames.get(target)) if (name !== "default" && !exportNames.get(file).has(name)) { exportNames.get(file).add(name); namesChanged = true; }
    }
  }
  function acquire(node, promise = false) {
    const spec = literal(node.arguments?.[0]);
    if (spec === null) return new Set(["unknown:computed module acquisition"]);
    if (["node:module", "module"].includes(spec)) return new Set(["module-factory"]);
    const targets = modules.get(`${fileOf(node)}\0${spec}`);
    if (!targets?.size) return spec.startsWith(".") || spec.startsWith("@changmen/") ? new Set(["unknown:unresolved workspace acquisition"]) : empty();
    const result = new Set([...targets].flatMap(file => promise ? [`promise:${file}`] : [...(cjs.get(file) || new Set([`ns:${file}`]))]));
    if (targets.size > 1 && hasCapability(result)) result.add("unknown:ambiguous module resolution");
    return result;
  }
  function member(base, name) {
    const result = empty();
    for (const token of base) {
      if (token === "module-factory" && name === "createRequire") { result.add("factory"); continue; }
      if (token === "cjs-module" && name === "require") { result.add("require"); continue; }
      if (["require", "factory"].includes(token) && ["bind", "call", "apply"].includes(name)) { result.add("unknown:unsupported module-loader transformation"); continue; }
      if (token.startsWith("ns:")) {
        if (name === null && hasCapability(new Set([token]))) result.add(`unknown:computed namespace property:${token.slice(3)}`);
        else if (name !== null && !exportNames.get(token.slice(3))?.has(name) && hasCapability(new Set([token]))) result.add("unknown:missing loader namespace export");
        else for (const value of exports.get(token.slice(3))?.get(name) || []) result.add(value);
      } else if (hasCapability(new Set([token]))) result.add("unknown:unsupported loader property or promise use");
    }
    return result;
  }
  function value(node) {
    if (!node) return empty();
    if (ts.isIdentifier(node)) {
      const own = values.get(symbol(node));
      return own || (isGlobal(node, "require") ? new Set(["require"]) : isGlobal(node, "module") ? new Set(["cjs-module"]) : empty());
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) return value(node.expression);
    if (ts.isAwaitExpression(node)) return new Set([...value(node.expression)].map(token => token.startsWith("promise:") ? `ns:${token.slice(8)}` : token));
    if (ts.isPropertyAccessExpression(node)) return member(value(node.expression), node.name.text);
    if (ts.isElementAccessExpression(node)) return member(value(node.expression), literal(node.argumentExpression));
    if (ts.isConditionalExpression(node)) {
      const branches = union(value(node.whenTrue), value(node.whenFalse));
      return hasCapability(branches) ? union(branches, new Set(["unknown:conditional loader selection"])) : branches;
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return acquire(node, true);
      const callee = value(node.expression);
      if (callee.has("require")) return acquire(node);
      if (callee.has("factory")) return new Set(["require"]);
    }
    return empty();
  }
  function hasCapability(tokens, seen = new Set()) {
    for (const token of tokens) {
      if (token.startsWith("fn:") || token.startsWith("unknown:")) return true;
      if (token.startsWith("ns:") || token.startsWith("promise:")) {
        const file = token.slice(token.indexOf(":") + 1);
        if (seen.has(file)) continue;
        seen.add(file);
        if ([...(exports.get(file)?.values() || [])].some(set => hasCapability(set, seen))) return true;
      }
    }
    return false;
  }
  function bind(name, tokens) {
    let changed = false;
    if (ts.isIdentifier(name)) return add(values, symbol(name), tokens);
    if (ts.isObjectBindingPattern(name)) for (const element of name.elements) {
      const key = element.propertyName ? ts.isIdentifier(element.propertyName) ? element.propertyName.text : literal(element.propertyName) : ts.isIdentifier(element.name) ? element.name.text : null;
      changed = bind(element.name, (element.dotDotDotToken || element.initializer) && hasCapability(tokens) ? new Set(["unknown:rest/default loader binding"]) : member(tokens, key)) || changed;
    }
    return changed;
  }
  // No runtime execution: propagate only finite explicit imports, exports and immutable aliases.
  let changed = true, passes = 0;
  while (changed && passes++ < Math.max(16, trees.size * 2 + 4)) {
    changed = false;
    for (const [file, tree] of trees) {
      const exported = exports.get(file);
      function visit(node) {
        if (ts.isImportDeclaration(node)) {
          const spec = literal(node.moduleSpecifier), clause = node.importClause, targets = modules.get(`${file}\0${spec}`) || empty();
          const ns = new Set([...targets].map(file => `ns:${file}`));
          if (targets.size > 1 && hasCapability(ns)) ns.add("unknown:ambiguous module resolution");
          if (["node:module", "module"].includes(spec)) for (const element of clause?.namedBindings?.elements || []) if ((element.propertyName || element.name).text === "createRequire") changed = add(values, symbol(element.name), new Set(["factory"])) || changed;
          if (clause?.name) { changed = add(values, symbol(clause.name), union(new Set([...ns].filter(token => token.startsWith("unknown:"))), ...[...targets].map(file => cjs.get(file) || member(new Set([`ns:${file}`]), "default")))) || changed; if (clause.isTypeOnly) typeSymbols.add(symbol(clause.name)); }
          if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) { changed = add(values, symbol(clause.namedBindings.name), ["node:module", "module"].includes(spec) ? new Set(["module-factory"]) : ns) || changed; if (clause.isTypeOnly) typeSymbols.add(symbol(clause.namedBindings.name)); }
          for (const element of clause?.namedBindings?.elements || []) { changed = add(values, symbol(element.name), member(ns, (element.propertyName || element.name).text)) || changed; if (clause.isTypeOnly || element.isTypeOnly) typeSymbols.add(symbol(element.name)); }
        }
        if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
          const targets = modules.get(`${file}\0${literal(node.moduleReference.expression)}`) || empty();
          const tokens = union(...[...targets].map(file => cjs.get(file) || new Set([`ns:${file}`])));
          if (targets.size > 1 && hasCapability(tokens)) tokens.add("unknown:ambiguous module resolution");
          changed = add(values, symbol(node.name), tokens) || changed;
          if (node.isTypeOnly) typeSymbols.add(symbol(node.name));
        }
        if (ts.isVariableDeclaration(node) && node.initializer) changed = bind(node.name, value(node.initializer)) || changed;
        if (ts.isFunctionDeclaration(node) && node.name && modifiers(node)) changed = add(exported, node.modifiers.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) ? "default" : node.name.text, value(node.name)) || changed;
        if (ts.isVariableStatement(node) && modifiers(node)) for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) changed = add(exported, declaration.name.text, value(declaration.name)) || changed;
        if (ts.isExportAssignment(node)) changed = add(exported, "default", value(node.expression)) || changed;
        if (ts.isExportDeclaration(node)) {
          const ns = node.moduleSpecifier ? new Set([...(modules.get(`${file}\0${literal(node.moduleSpecifier)}`) || [])].map(file => `ns:${file}`)) : null;
          if (ns?.size > 1 && hasCapability(ns)) ns.add("unknown:ambiguous module resolution");
          if (node.exportClause && ts.isNamedExports(node.exportClause)) for (const element of node.exportClause.elements) {
            const target = ns ? member(ns, (element.propertyName || element.name).text) : values.get(checker.getExportSpecifierLocalTargetSymbol(element)) || empty();
            changed = add(exported, element.name.text, target) || changed;
          } else if (node.exportClause && ts.isNamespaceExport(node.exportClause)) changed = add(exported, node.exportClause.name.text, ns) || changed;
          else if (ns) for (const token of ns) for (const [name, tokens] of exports.get(token.slice(3)) || []) if (name !== "default") changed = add(exported, name, union(tokens, new Set([...ns].filter(token => token.startsWith("unknown:"))))) || changed;
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          const name = exportName(node.left);
          if (name !== null) changed = add(exported, name, value(node.right)) || changed;
          if (moduleExports(node.left)) {
            if (ts.isObjectLiteralExpression(node.right)) {
              changed = add(cjs, file, new Set([`ns:${file}`])) || changed;
              for (const p of node.right.properties) {
              const key = p.name && (ts.isIdentifier(p.name) ? p.name.text : literal(p.name));
              if (key) changed = add(exported, key, ts.isShorthandPropertyAssignment(p) ? values.get(symbol(p.name)) || empty() : ts.isPropertyAssignment(p) ? value(p.initializer) : empty()) || changed;
              }
            } else changed = add(cjs, file, value(node.right)) || changed;
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(tree);
    }
  }
  if (changed) violations.push({ rule: "pm-loader-unknown", file: "<graph>", line: 0, pattern: "loader provenance did not converge", spec: "fixed point" });

  function safeExportReference(node) {
    const parent = node.parent;
    if (ts.isExportAssignment(parent)) return true;
    if (ts.isBinaryExpression(parent) && parent.right === node) return moduleExports(parent.left) || exportName(parent.left) !== null;
    if (ts.isShorthandPropertyAssignment(parent) || ts.isPropertyAssignment(parent) && parent.initializer === node) {
      const object = parent.parent, assignment = object.parent;
      return (ts.isIdentifier(parent.name) || ts.isStringLiteralLike(parent.name)) && ts.isObjectLiteralExpression(object) && ts.isBinaryExpression(assignment) && assignment.right === object && moduleExports(assignment.left);
    }
    return false;
  }
  function typeOnly(node) { for (let p = node.parent; p && !ts.isStatement(p); p = p.parent) if (ts.isTypeNode(p)) return true; return false; }
  for (const [file, tree] of trees) {
    function visit(node) {
      if (ts.isCallExpression(node)) {
        const tokens = value(node.expression);
        if (hasCapability(tokens)) {
          const functions = [...tokens].filter(token => token.startsWith("fn:"));
          if (tokens.size !== 1 || functions.length !== 1 || node.arguments.some(arg => literal(arg) === null)) reject(node, "loader source or arguments are unknown; review before accepting this call");
          else {
            const key = functions[0].slice(3), origin = registered.get(key);
            calls.push({ file, line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, origin: { file: origin.file, symbol: origin.symbol }, arguments: node.arguments.map(literal), callee: node.expression.getText(tree) });
          }
        }
      }
      // Validate every capability-valued expression, not just recognizable call spellings.
      if (ts.isExpression(node) && hasCapability(value(node)) && !typeOnly(node)) {
        const parent = node.parent;
        let safe = false;
        if (ts.isIdentifier(node) && (ts.isFunctionDeclaration(parent) && parent.name === node || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isImportClause(parent) || ts.isImportEqualsDeclaration(parent) || ts.isExportSpecifier(parent))) safe = true;
        if (ts.isVariableDeclaration(parent) && parent.name === node || ts.isBindingElement(parent) && parent.name === node) safe = true;
        if (ts.isPropertyAccessExpression(parent) && parent.name === node) safe = true;
        if (ts.isPropertyAccessExpression(parent) && parent.expression === node || ts.isElementAccessExpression(parent) && parent.expression === node) safe = true;
        if (ts.isCallExpression(parent) && parent.expression === node) safe = true;
        if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent) || ts.isNonNullExpression(parent) || ts.isAwaitExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isConditionalExpression(parent)) safe = true;
        if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
          safe = Boolean(parent.parent.flags & ts.NodeFlags.Const);
          if (!safe) reject(node, "mutable loader alias requires explicit review");
          if (ts.isArrayBindingPattern(parent.name)) safe = false;
        }
        if (safeExportReference(node)) safe = true;
        if ([...value(node)].some(token => token.startsWith("unknown:")) && !reviewedAcquisition(file, node)) { reject(node, "unknown namespace/acquisition or unsupported loader transformation"); safe = true; }
        if (!safe && !reviewedAcquisition(file, node)) reject(node, "loader function/namespace escapes a tracked immutable binding or direct call");
        if (ts.isBinaryExpression(parent) && parent.left === node || ts.isDeleteExpression(parent) || ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) reject(node, "loader binding or namespace mutation requires review");
        if ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node
          && (ts.isBinaryExpression(parent.parent) && parent.parent.left === parent || ts.isDeleteExpression(parent.parent))) reject(node, "loader namespace mutation requires review");
        if (ts.isIdentifier(node) && typeSymbols.has(symbol(node)) && !ts.isImportSpecifier(parent) && !ts.isNamespaceImport(parent) && !ts.isImportClause(parent) && !ts.isImportEqualsDeclaration(parent)) reject(node, "type-only loader import is not a runtime binding");
      }
      if (ts.isBindingElement(node) && (node.dotDotDotToken || node.initializer) && hasCapability(value(node.name))) reject(node, "rest/default namespace binding is not certified");
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  if (facade) for (const [name, origin] of Object.entries(facade.exports)) {
    const tokens = exports.get(facade.file)?.get(name) || empty();
    if (tokens.size !== 1 || !tokens.has(`fn:${origin}`)) violations.push({ rule: "pm-loader-origin", file: facade.file, line: 0, spec: name, pattern: "facade export must retain its reviewed real function definition" });
  }
  const counts = new Map();
  for (const call of calls) counts.set(callKey(call), (counts.get(callKey(call)) || 0) + 1);
  const keys = new Set();
  for (const expected of expectedCalls) {
    const key = callKey(expected);
    if (keys.has(key) || !registered.has(originKey(expected.origin)) || !Number.isInteger(expected.count) || expected.count < 1 || !Array.isArray(expected.arguments) || expected.arguments.some(arg => typeof arg !== "string")) throw Error("Invalid source-bound loader call registration");
    keys.add(key);
    if ((counts.get(key) || 0) !== expected.count) violations.push({ rule: "pm-loader-call", file: expected.file, line: 0, spec: expected.origin.symbol, pattern: "source-bound loader call disappeared, changed source/arguments, or changed count" });
  }
  for (const call of calls) if (!keys.has(callKey(call))) violations.push({ rule: "pm-loader-call", ...call, spec: call.callee, pattern: "unreviewed source-bound loader call" });
  return { origins, calls, violations, safeToNarrowPublishScope: false, publishScopeOptimizationEnabled: false };
}

/** Include only the already-evidenced default preload inventory and its true source dependencies. */
export function inspectPmLoaderBindings(root, manifest, graph, sharedEvidence) {
  const policy = JSON.parse(fs.readFileSync(path.join(root, "scripts/verification/pm-loader-binding-inputs.json"), "utf8"));
  if (policy.schemaVersion !== 1 || policy.purpose !== "pm-loader-binding-gate-only" || policy.publishScopeOptimizationEnabled !== false) throw Error("Loader binding gate cannot choose publication scope");
  const central = "packages/venue-adapter/loader/adapter_paths.mjs";
  const probeHelpers = ["devtools/platform-probes/backend/_paths.js", "devtools/platform-probes/backend/_paths.cjs"];
  const required = [...["reqS", "backendRequire", "adapterRequire", "requirePlatform"].map(symbol => `${central}#${symbol}`), ...probeHelpers.flatMap(file => ["reqS", "backendRequire"].map(symbol => `${file}#${symbol}`))];
  const clean = file => typeof file === "string" && file.length > 0 && !file.includes("\\") && !path.posix.isAbsolute(file) && !/^[a-z]:/i.test(file) && !file.split("/").some(part => part === ".." || part === ".");
  if (!Array.isArray(policy.origins) || policy.origins.length !== required.length || required.some(key => !policy.origins.some(row => originKey(row) === key))
    || policy.facade?.file !== "server/backend/core/shared/adapter_paths.js"
    || ["reqS", "backendRequire", "adapterRequire", "requirePlatform"].some(name => policy.facade.exports?.[name] !== `${central}#${name}`)
    || !Array.isArray(policy.sourceContracts) || policy.sourceContracts.length !== probeHelpers.length
    || probeHelpers.some(file => !policy.sourceContracts.some(row => row.file === file && row.selector === "module" && /^[a-f0-9]{64}$/.test(row.signature)))
    || !Array.isArray(policy.calls) || !policy.calls.length || policy.calls.some(row => !clean(row.file))) throw Error("Incomplete or redirected PM loader binding policy");
  const contracts = policy.sourceContracts.map(row => ({ ...row, matched: sharedLoaderSourceSignature(row.file, fs.readFileSync(path.join(root, row.file), "utf8"), row.selector) === row.signature }));
  const preload = sharedEvidence.defaultScenario;
  const runtimeRoots = preload ? [...new Set([...preload.preloadFiles.map(row => row.file), ...preload.targetEvidence.filter(row => row.file.startsWith("devtools/platform-probes/")).map(row => row.file)])] : [];
  const expanded = preload ? inspectComponentEntries(root, { ...manifest, scopes: { ...manifest.scopes, pm: { ...manifest.scopes.pm, nodeRoots: [...manifest.scopes.pm.nodeRoots, ...runtimeRoots] } } }, { scope: "pm" }) : graph;
  const checked = new Map([...sharedEvidence.sourceContracts, ...contracts].filter(row => row.matched).map(row => [row.file, row.selector]));
  function reviewedAcquisition(file, node) {
    const selector = checked.get(file);
    if (selector === "module") return true;
    if (selector === "pg-loader") for (let p = node; p; p = p.parent) if (ts.isFunctionDeclaration(p) && p.name?.text === "requirePg" && ts.isSourceFile(p.parent)) return true;
    return false;
  }
  const files = Object.fromEntries(expanded.sourceFiles.map(file => [file, fs.readFileSync(path.join(root, file), "utf8")]));
  const result = analyzePmLoaderBindings({ files, dependencies: expanded.dependencies, origins: policy.origins, expectedCalls: policy.calls, facade: policy.facade, reviewedAcquisition });
  const unknownKey = row => JSON.stringify([row.file, row.kind, row.expression, row.loaderSymbol, row.arguments]);
  const originalUnknowns = new Set(graph.unknown.map(unknownKey));
  for (const site of expanded.unknown) {
    if (originalUnknowns.has(unknownKey(site))) continue;
    if (contracts.some(row => row.file === site.file && row.matched)) continue;
    if (site.kind === "custom-loader" && result.calls.some(call => call.file === site.file && call.line === site.line)) continue;
    result.violations.push({ rule: "pm-loader-unknown", ...site, pattern: "unexplained input in PM runtime dependency expansion; fail closed instead of narrowing scope" });
  }
  for (const row of contracts.filter(row => !row.matched)) result.violations.push({ rule: "pm-loader-origin", file: row.file, line: 0, spec: row.selector, pattern: "probes loader interpretation changed; recheck source binding and search rules" });
  if (!preload) result.violations.push({ rule: "pm-loader-unknown", file: "<runtime-inputs>", line: 0, spec: "preload", pattern: "no reviewed default runtime inventory; cannot certify bounded loader bindings" });
  else if (!preload.applicableToAuditorProcess) result.violations.push({ rule: "pm-loader-unknown", file: "<runtime-inputs>", line: 0, spec: "environment override", pattern: "default workspace inventory does not cover configured roots/search hooks; external contents remain uninspected" });
  result.violations.push(...expanded.violations);
  return { ...result, sourceContracts: contracts, runtimeRoots, scannedSourceFiles: expanded.sourceFiles.length,
    nodeSourceFiles: expanded.nodeSourceFiles, browserSourceFiles: expanded.browserSourceFiles,
    rawUnknowns: expanded.unknown.length, originalUnknowns: graph.unknown.length,
    inputEvidence: expanded.sourceFiles.map(file => ({ file, sha256: hash(files[file]) })),
    runtimeRootsCertified: false, limitations: ["Default workspace runtime inputs only; no external root or production heap certification.", "Unsupported loader escapes, computed acquisition and unresolved provenance fail the gate; external dependency internals are not executed or certified."] };
}

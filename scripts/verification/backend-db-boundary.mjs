import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";

export const databaseBoundaryBaseline = "d3fd4a0a02794c3826b8f56a131ceed4bc249caf";
export const migratedDatabaseConsumers = [
  "server/backend/core/account/admin_maintenance.js",
  "server/backend/core/account/user_login_meta.js",
  "server/backend/core/account/user_presence.js",
  "server/backend/core/account/admin_service.js",
  "server/backend/core/esport-api/value_bet_service.js",
  "server/backend/core/esport-api/sport_predictfun_fetch.js",
  "server/backend/core/shared/runtime_version.js",
];
const lowLevel = new Set(["getPgPool", "ensurePgPoolReady", "Pool", "Client", "query"]);
const hash = text => createHash("sha256").update(text).digest("hex");
const sourceFile = file => /\.[cm]?[jt]sx?$/.test(file) && !/\.(test|spec)\./.test(file);

/** AST inspection: imports, re-exports and execution sites, including aliases and computed members. */
export function databaseAccessSites(file, source) {
  source = source.replaceAll("\r\n", "\n");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  if (tree.parseDiagnostics.length) throw Error(`Cannot inspect database boundary: ${file}`);
  const sites = [], namespaces = new Set(), loaders = new Set(["require"]), requireFactories = new Set();
  const literal = node => node && (ts.isStringLiteralLike(node) ? node.text : null);
  function record(node, kind) {
    const owners = [];
    for (let owner = node.parent; owner; owner = owner.parent) {
      if ((ts.isFunctionDeclaration(owner) || ts.isVariableDeclaration(owner)) && owner.name) owners.push(owner.name.getText(tree));
    }
    const context = owners.reverse().join("/") || "module";
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, node.getText(tree));
    const tokens = [];
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) tokens.push([token, scanner.getTokenText()]);
    sites.push({ file, kind, context, signature: hash(JSON.stringify(tokens)), line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1 });
  }
  function importSite(node, spec, names, dynamic = false) {
    if (!spec) return;
    const resolved = spec.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)) : spec;
    if (/^(pg|pg-pool)(\/|$)/.test(spec) || resolved.startsWith("rds/") || resolved.startsWith("server/db/") || /^@changmen\/db\/(?:rds\/|pg(?:_pool)?\.js|impl_rds\.js|index\.js)/.test(spec)) record(node, "database-internal-import");
    else if ((spec === "@changmen/db" || spec.startsWith("@changmen/db/")) && (dynamic && spec === "@changmen/db" || names.some(name => lowLevel.has(name) || name === "*"))) record(node, "database-pool-import");
  }
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const spec = literal(node.moduleSpecifier), bindings = node.importClause?.namedBindings;
      if ((spec === "node:module" || spec === "module") && bindings && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) if ((binding.propertyName || binding.name).text === "createRequire") requireFactories.add(binding.name.text);
      }
      if (spec === "@changmen/db" && bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      const names = bindings && ts.isNamedImports(bindings) ? bindings.elements.map(e => (e.propertyName || e.name).text) : [];
      importSite(node, spec, names, Boolean(node.importClause?.name));
    } else if (ts.isExportDeclaration(node)) {
      const names = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map(e => (e.propertyName || e.name).text) : ["*"];
      importSite(node, literal(node.moduleSpecifier), names);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(callee) && loaders.has(callee.text)) importSite(node, literal(node.arguments[0]), [], true);
      let member = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isElementAccessExpression(callee) ? literal(callee.argumentExpression) : null;
      if (member === "query" || member && lowLevel.has(member) || ts.isIdentifier(callee) && lowLevel.has(callee.text)) record(node, "database-execution");
    }
    // Destructuring and property aliases must not hide low-level capabilities.
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name) && ts.isCallExpression(node.initializer) && ts.isIdentifier(node.initializer.expression) && requireFactories.has(node.initializer.expression.text)) loaders.add(node.name.text);
      if (ts.isIdentifier(node.name) && ts.isIdentifier(node.initializer) && loaders.has(node.initializer.text)) loaders.add(node.name.text);
      if (ts.isObjectBindingPattern(node.name) && node.name.elements.some(e => lowLevel.has((e.propertyName || e.name).getText(tree).replaceAll(/["']/g, "")))) record(node, "database-capability-alias");
      if (ts.isPropertyAccessExpression(node.initializer) && lowLevel.has(node.initializer.name.text)) record(node, "database-capability-alias");
      if (ts.isElementAccessExpression(node.initializer) && lowLevel.has(literal(node.initializer.argumentExpression))) record(node, "database-capability-alias");
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  function inspectComputed(node) {
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && namespaces.has(node.expression.text)) {
      const member = literal(node.argumentExpression);
      if (member === null || lowLevel.has(member)) record(node, "database-computed-capability");
    }
    ts.forEachChild(node, inspectComputed);
  }
  inspectComputed(tree);
  return sites;
}

export function databaseAccessInventory(root) {
  const sites = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (sourceFile(file)) sites.push(...databaseAccessSites(file, fs.readFileSync(path.join(root, file), "utf8")));
    }
  }
  walk("server/backend/core");
  return sites;
}

export const databaseSiteKey = site => JSON.stringify([site.file, site.kind, site.context, site.signature]);
export function unregisteredDatabaseSites(current, exceptions) {
  const remaining = new Map();
  for (const site of exceptions) {
    const key = databaseSiteKey(site);
    remaining.set(key, (remaining.get(key) || 0) + 1);
  }
  return current.filter(site => {
    if (migratedDatabaseConsumers.includes(site.file)) return true;
    const key = databaseSiteKey(site), count = remaining.get(key) || 0;
    if (count) remaining.set(key, count - 1);
    return count === 0;
  });
}

export function checkDatabaseAccessBoundaries(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "scripts/verification/backend-db-access-exceptions.json"), "utf8"));
  if (manifest.baseline !== databaseBoundaryBaseline) throw Error("Database boundary baseline changed");
  // Every exception must actually exist in the fixed released source, not in a new working tree.
  for (const file of new Set(manifest.sites.map(s => s.file))) {
    if (!file.startsWith("server/backend/core/") || !sourceFile(file) || migratedDatabaseConsumers.includes(file)) throw Error(`Invalid database exception: ${file}`);
    const source = execFileSync("git", ["show", `${databaseBoundaryBaseline}:${file}`], { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    if (unregisteredDatabaseSites(manifest.sites.filter(s => s.file === file), databaseAccessSites(file, source)).length) throw Error(`Database exception expands released source: ${file}`);
  }
  return unregisteredDatabaseSites(databaseAccessInventory(root), manifest.sites).map(site => ({ rule: "backend-database-access", file: site.file, line: site.line, spec: site.kind, pattern: "SQL belongs to the data layer; only exact historical sites remain" }));
}

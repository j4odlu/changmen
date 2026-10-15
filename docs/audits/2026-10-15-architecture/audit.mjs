/** Read-only architecture evidence. Run from any cwd with repository dependencies installed. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { changePlan } from '../../../scripts/deploy/change-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const roots = ['client/web/src', 'server/backend', 'server/db', 'server/match', 'packages',
  'chrome-extension/src', 'server/collectors', 'server/ws_forward', 'server/realtime-hub'];
const excluded = new Set(['node_modules', 'dist', 'storage', 'archive', 'public',
  'platform_adapter', 'platform_node', 'docs', 'scripts']);
const files = [];
function walk(dir) {
  if (!fs.existsSync(path.join(root, dir))) return;
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:[cm]?js|tsx?|vue)$/.test(file)
      && !/(?:\.test\.|\.spec\.|\.smoke\.|\/tests?\/|\.d\.ts$)/.test(file)) files.push(file);
  }
}
roots.forEach(walk);
const web = files.filter(file => file.startsWith('client/web/src/'));
const webSet = new Set(web.map(file => path.join(root, file)));
function resolve(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = path.resolve(root, 'client/web/src', spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(root, path.dirname(from), spec);
  else return null;
  for (const candidate of [base, ...['.ts', '.tsx', '.vue', '.js', '/index.ts'].map(ext => base + ext)]) {
    if (webSet.has(candidate)) return path.relative(root, candidate).replaceAll('\\', '/');
  }
  return null;
}
const edges = [];
for (const file of web) {
  let source = read(file);
  if (file.endsWith('.vue')) source = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).join('\n');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const add = (node, spec, kind) => {
    const target = resolve(file, spec);
    if (target) edges.push({ from: file, to: target, kind,
      scriptLine: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
  };
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typeOnly = node.isTypeOnly || clause?.isTypeOnly
        || (named && ts.isNamedImports(named) && !clause.name && named.elements.length > 0
          && named.elements.every(item => item.isTypeOnly))
        || (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)
          && node.exportClause.elements.length > 0 && node.exportClause.elements.every(item => item.isTypeOnly));
      add(node, node.moduleSpecifier.text, typeOnly ? 'type' : 'static');
    }
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      add(node, node.arguments[0].text, 'dynamic');
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
function components(includeDynamic) {
  const graph = new Map(web.map(file => [file, new Set()]));
  for (const edge of edges) if (edge.kind === 'static' || (includeDynamic && edge.kind === 'dynamic'))
    graph.get(edge.from).add(edge.to);
  let index = 0;
  const ids = new Map(), low = new Map(), stack = [], active = new Set(), groups = [];
  function strong(file) {
    ids.set(file, index); low.set(file, index++); stack.push(file); active.add(file);
    for (const target of graph.get(file) || []) {
      if (!ids.has(target)) { strong(target); low.set(file, Math.min(low.get(file), low.get(target))); }
      else if (active.has(target)) low.set(file, Math.min(low.get(file), ids.get(target)));
    }
    if (ids.get(file) === low.get(file)) {
      const members = []; let target;
      do { target = stack.pop(); active.delete(target); members.push(target); } while (target !== file);
      if (members.length > 1) groups.push(members.sort());
    }
  }
  web.forEach(file => { if (!ids.has(file)) strong(file); });
  return groups.sort((a, b) => b.length - a.length).map(members => ({ count: members.length, members }));
}

// Execute the actual cache function bodies with in-memory ports, never import DB/runtime modules.
// These two reproductions are pinned to the audited pre-fix commit; current fixes have dedicated tests.
const cacheBaselineCommit = '1f9ca758959a24d947439bc42be6ae2ce5c3661e';
function functionBody(file, name) {
  const historical = execFileSync('git', ['show', `${cacheBaselineCommit}:${file}`], { cwd: root, encoding: 'utf8', windowsHide: true });
  const ast = ts.createSourceFile(file, historical, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert(declaration?.body, `Missing ${name}`);
  return declaration.getText(ast).replace(/^export\s+/, '');
}
const cacheFile = 'server/backend/core/db/store.js';
const accountsCache = new Map();
const replaceAccounts = new Function('sb', 'normalizeAccountList', '_accountsCache', 'accountsPersistUnchanged',
  `${functionBody(cacheFile, 'replaceAccountsForUser')}; return replaceAccountsForUser;`)(
  { saveAccountRecordsForOwner: async () => 0 }, value => value, accountsCache, () => false);
await replaceAccounts('audit-user', [{ accountId: 1, token: 'synthetic-value' }]);
const zeroRowsPublished = accountsCache.get('audit-user')?.length === 1;
assert(zeroRowsPublished);

const profiles = new Map([['audit-user', { betting_config: { prior: true }, preferences: {} }]]);
const pending = [];
const updateSetting = new Function('_get', '_set', '_restoreRow', 'sb', 'getProfileById',
  `${functionBody(cacheFile, 'updateProfileSetting')}; return updateProfileSetting;`)(
  uid => profiles.get(uid), (uid, value) => profiles.set(uid, value),
  (uid, value) => profiles.set(uid, value),
  { writeProfileAsync: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) },
  uid => profiles.get(uid));
const first = updateSetting('audit-user', { first: true }).catch(() => {});
const second = updateSetting('audit-user', { second: true });
pending[1].resolve(); await second;
pending[0].reject(new Error('synthetic failure')); await first;
const laterCacheWriteRolledBack = profiles.get('audit-user').betting_config.second === undefined;
assert(laterCacheWriteRolledBack);

const migrationFiles = fs.readdirSync(path.join(root, 'server/backend/db/migrations')).filter(file => file.endsWith('.sql'));
const runner = read('server/backend/scripts/apply-rds-schema.mjs');
const missedNumberedMigrations = migrationFiles.filter(file => /^\d{3}_/.test(file)
  && !runner.includes(`"${file}"`)).sort();
const samplePaths = ['packages/venue-adapter/ob/bet.ts', 'client/web/src/runtime/collectors.ts',
  'server/match/matcher/ops/match_merge_once.js', 'server/db/rds/player_store.js'];
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const inbound = new Map();
for (const edge of edges) if (edge.kind !== 'type') {
  if (!inbound.has(edge.to)) inbound.set(edge.to, new Set());
  inbound.get(edge.to).add(edge.from);
}
const result = {
  scope: 'working tree; static evidence and synthetic port failures; no production or DB calls',
  commit: git('rev-parse', 'HEAD'),
  sourceFingerprints: Object.fromEntries([
    'server/backend/core/db/store.js', 'server/backend/core/account/account_service.js',
    'server/db/rds/player_store.js', 'server/db/rds/common.js',
    'server/backend/scripts/apply-rds-schema.mjs', 'server/backend/server.js',
    'server/match/matcher/ops/match_merge_once.js', 'server/match/matcher/ops/rds_snapshot_cache.js',
    'scripts/deploy/classify-deploy-scope.mjs', 'scripts/verification/validation-plan.mjs',
    'server/backend/package.json', 'server/db/package.json',
  ].map(file => [file, createHash('sha256').update(read(file)).digest('hex')])),
  sourceInventory: roots.map(dir => ({ root: dir, files: files.filter(file => file.startsWith(`${dir}/`)).length })),
  inventoryExcludes: [...excluded, '*.test.*', '*.spec.*', '*.smoke.*', 'test/', 'tests/', '*.d.ts'],
  limits: ['web graph resolves only relative and @/ imports within selected production files',
    'external workspace modules, nonliteral imports and runtime bridge calls are not resolved',
    'Vue import line numbers are relative to extracted script content',
    'SCC proves structural coupling, not an initialization crash or production performance issue',
    'backend source inventory includes available generated router JS alongside TS'],
  a8: { file: 'A8/index0706.js', sha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'A8/index0706.js'))).digest('hex') },
  webStaticComponents: components(false),
  webStaticAndDynamicComponents: components(true),
  runtimeInbound: [...inbound].map(([file, sources]) => ({ file, consumers: sources.size }))
    .sort((a, b) => b.consumers - a.consumers).slice(0, 15),
  cacheFailureReproductions: { zeroRowsPublished, laterCacheWriteRolledBack,
    baselineCommit: cacheBaselineCommit,
    method: 'pre-fix function bodies from the audit baseline with synthetic dependencies; current behavior is verified by backend/DB tests' },
  missedNumberedMigrations,
  testTopology: {
    dbTestCommand: JSON.parse(read('server/db/package.json')).scripts?.test ?? null,
    backendTestCommand: JSON.parse(read('server/backend/package.json')).scripts.test,
    rootChecks: JSON.parse(read('package.json')).scripts['test:checks'],
  },
  scopeExamples: samplePaths.map(file => {
    const plan = changePlan([file]);
    const release = changePlan([file], { purpose: 'release' });
    return { file, localValidationTier: plan.tier, publication: release.deployment.scope,
      localChecks: plan.checks, releaseChecks: release.checks };
  }),
  domainStoreEdges: edges.filter(edge => edge.from.includes('/domain/') && edge.to.includes('/stores/')),
};
console.log(JSON.stringify(result, null, 2));

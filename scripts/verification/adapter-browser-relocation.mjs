import {withAdapterHistoryReader} from "./browser-entry-history.mjs";
// [changmen 扩展] Browser implementation relocation only. Original protection baselines remain authoritative.
import assert from "node:assert/strict";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import path from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import { classifySourceFile } from "./source-ownership.mjs";
import { restoreBrowserEntryRetirement } from './browser-entry-history.mjs';

const normalize = source => source.replaceAll("\r\n", "\n");
const sha = source => createHash("sha256").update(normalize(source)).digest("hex");
const text = fs.readFileSync(new URL("./adapter-browser-relocation.json", import.meta.url), "utf8");
assert.equal(sha(text), "a114f11ce18799965f900333f01ac6b55d9a0cbc065b6bfba729ff67f431b00d", "Reviewed adapter relocation inventory changed");
export const ADAPTER_BROWSER_RELOCATION = JSON.parse(text);
assert.equal(ADAPTER_BROWSER_RELOCATION.baselineCommit, "c3bf0ac3e20d5221dfc36a79fc3a01f5487af9e1");
assert.equal(ADAPTER_BROWSER_RELOCATION.publishScopeOptimizationEnabled, false);
assert.equal(ADAPTER_BROWSER_RELOCATION.records.length, 595);
const entries = new Map(ADAPTER_BROWSER_RELOCATION.records.map(row => [row.file, row]));
const readFile = withAdapterHistoryReader(file => fs.readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"));

export function restoreAdapterBrowserSource(row, source) {
  source = normalize(source);
  assert.equal(sha(source), row.afterSha, `${row.canonical}: complete relocated source changed`);
  for (const edit of [...row.replacements].reverse()) {
    assert.equal(source.slice(edit.offset, edit.offset + edit.after.length), edit.after, `${row.canonical}: exact relocated import`);
    source = source.slice(0, edit.offset) + edit.before + source.slice(edit.offset + edit.after.length);
  }
  assert.equal(sha(source), row.beforeSha, `${row.file}: complete original module must restore`);
  return source;
}

export function readAdapterBrowserSource(file, source, read = readFile) {
  source = restoreBrowserEntryRetirement(file, source);
  const row = entries.get(file);
  if (!row || row.copiedOnly || normalize(source) !== row.wrapper) return source;
  return restoreAdapterBrowserSource(row, read(row.canonical));
}

export function adapterBrowserSourceReader(read) {
  const historical = withAdapterHistoryReader(read);
  return file => readAdapterBrowserSource(file, historical(file), historical);
}

export function restoreAdapterBrowserMetadata(file, source) {
  source = restoreBrowserEntryRetirement(file, source);
  const row = ADAPTER_BROWSER_RELOCATION.metadata.find(item => item.file === file);
  if (!row || sha(source) !== row.afterSha) return source;
  assert.equal(sha(row.before), row.beforeSha, `${file}: previous metadata snapshot changed`);
  return row.before;
}

export function verifyAdapterBrowserRelocation(read = readFile) {
  read = withAdapterHistoryReader(read);
  const certified = new Set();
  for (const row of entries.values()) {
    assert.equal(row.canonical, `client/packages/venue-browser/adapter/${row.file.slice("packages/venue-adapter/".length)}`);
    assert.equal(normalize(read(row.file)), row.wrapper, `${row.file}: exact compatibility entry required`);
    restoreAdapterBrowserSource(row, read(row.canonical));
    certified.add(row.file); certified.add(row.canonical);
  }
  for (const row of ADAPTER_BROWSER_RELOCATION.metadata)
    assert.equal(sha(restoreAdapterBrowserMetadata(row.file, read(row.file))), row.beforeSha, `${row.file}: exact dependency/exports change`);
  return certified;
}

export function inspectAdapterBrowserRelocation(root) {
  const base = fs.realpathSync(root);
  const read = withAdapterHistoryReader(file => {
    const target = fs.realpathSync(path.join(base, file)), relative = path.relative(base, target);
    assert(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), "Adapter relocation escapes workspace");
    return fs.readFileSync(target, "utf8");
  });
  verifyAdapterBrowserRelocation(read);
  const ownership = JSON.parse(read("scripts/verification/source-ownership-inputs.json"));
  const visit = directory => {
    for (const item of fs.readdirSync(path.join(base, directory), { withFileTypes: true })) {
      if (item.name === "node_modules" || item.name === "dist") continue;
      const file = `${directory}/${item.name}`;
      if (item.isDirectory()) { visit(file); continue; }
      if (!/\.[cm]?[jt]sx?$/.test(file) || classifySourceFile(file, ownership)?.layer !== "frontend") continue;
      const tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
      assert.equal(tree.parseDiagnostics.length, 0, `${file}: invalid compatibility module`);
      assert(tree.statements.every(node => ts.isExportDeclaration(node) && node.moduleSpecifier
        || ts.isImportDeclaration(node) && !node.importClause || ts.isEmptyStatement(node)),
        `${file}: browser implementation must live under client/, not the compatibility package`);
    }
  };
  visit("packages/venue-adapter");
  return { files: entries.size, implementations: [...entries.values()].filter(row => !row.copiedOnly && !/\.(test|spec)\./.test(row.file)).length };
}

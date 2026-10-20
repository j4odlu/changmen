import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
// [changmen 扩展] Verify the entire erased sports implementation before returning
// its fixed pre-migration source to the unchanged legacy FOK input comparison.
import assert from "node:assert/strict";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { execFileSync } from "node:child_process";
import ts from "typescript";
const previousCommit = "84364793171244eca85378ef7bce3388f147b237";
const names = ["index", "gamma_poll", "sport_state", "parse_sport"];
export function erasePmSportsTypes(source) {
  assert.equal(ts.version, "6.0.3");
  return ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true,
  } }).outputText.replace(/(from\s+|import\s+)(["'])\.\/(index|gamma_map|gamma_poll|sport_state|resolve_match|parse_sport|prematch_prices|broadcast_notify)\.ts\2/g, "$1$2./$3.js$2");
}
export function restorePmSportsTypeScriptSource(file, source, typedSource) {
  const name = names.find(name => file === `server/collectors/polymarket-sports/${name}.js`);
  if (!name) return source;
  const original = execFileSync("git", ["show", `${previousCommit}:${file}`], { encoding: "utf8", windowsHide: true }).replaceAll("\r\n", "\n");
  if (source === original) return source;
  const shim = `// Compatibility entry; implementation is TypeScript.\n${name === "index" ? 'import "./index.ts";' : `export * from "./${name}.ts";`}\n`;
  assert.equal(source.replaceAll("\r\n", "\n"), shim, `${file}: only the exact compatibility entry is accepted`);
  const typed = typedSource ?? readAdapterHistory(file.replace(/\.js$/, ".ts"), "utf8");
  assert.equal(erasePmSportsTypes(typed), erasePmSportsTypes(original), `${file}: the complete runtime implementation must remain identical`);
  return original;
}

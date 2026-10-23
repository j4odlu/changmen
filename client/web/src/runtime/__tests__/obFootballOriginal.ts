import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as odds from "@/runtime/obSportOdds";
import * as ws from "@/runtime/obSportWs";
import * as league from "@/runtime/footballLeague";
import * as filter from "@/runtime/sportBoardFilter";
import * as codec from "@/runtime/obSportCodec";
import * as live from "@/runtime/obSportLive";
import { ObSportApiError } from "@/runtime/obSportApiError";

export const originalObFootball = execFileSync("git", ["show",
  "ea73dc5d2c65ccf2c320ddb9a852228fb15da269:client/web/src/runtime/obSportFootballFetch.ts"],
{ encoding: "utf8", windowsHide: true }).replaceAll("\r\n", "\n");
if (createHash("sha256").update(originalObFootball).digest("hex") !== "318032696b866700530c45a24a4695e1919a05bd5084508d82644c905db3c924")
  throw new Error("Original OB football source changed");
export const obFootballGroups = {
  obSportFootballResponse: ["asArray", "asObjectList", "nestedMatchRows", "teamNames", "bagRows", "unwrapData", "envelopeCodeOk", "obFlagOne", "obLeagueLooksElectronic", "isObElectronicFootball", "collectFootballMatches", "ingestOddsRow", "ingestOddsRows", "matchRowFromDecoded", "metaOrOddsNamed", "mergeSchedule"],
  obSportFootballDto: ["stableObMatchId", "startTimeMs", "isOutcomeLabel", "displayBetName", "isFootballListMarket", "obListGame", "clampLiveStart", "buildDto", "isObFootballPlaceholderTitle", "mergeMarketRows", "marketsFromRow"],
};
export const obRuntimeDir = path.resolve(import.meta.dirname, "..");
export const readObRuntime = (name: string) => readFileSync(path.join(obRuntimeDir, name + ".ts"), "utf8");
export const obAst = (source: string) => ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const compiled = new Map<string, string>();
function compile(source: string) {
  let js = compiled.get(source);
  if (!js) {
    const privateNames = obAst(source).statements.filter(ts.isFunctionDeclaration)
      .filter(n => !n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)).map(n => n.name!.text);
    js = ts.transpileModule(source + `\nexport { ${privateNames.join(", ")} };`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    compiled.set(source, js);
  }
  return js;
}
export const obSnapshot = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, v) =>
  Object.prototype.toString.call(v) === "[object Map]" ? { entries: [...v.entries()] } : v));

// Real parser/odds/codec/live dependencies; HTTP and browser state are the only ports.
// Each historical/current load has its own module state and cache.
export function loadObFootball(original: boolean, ports: Record<string, unknown> = {}, readNow = () => Date.now()) {
  const context = vm.createContext({ console: ports.console ?? console, Error, Date: class extends Date { static now() { return readNow(); } },
    setTimeout, clearTimeout, URLSearchParams, crypto: { randomUUID: () => "11111111-2222-3333-4444-555555555555" } });
  const defaults: Record<string, unknown> = {
    "@/runtime/obSportOdds": odds,
    "@/runtime/obSportWs": ws,
    "@/runtime/footballLeague": league,
    "@/runtime/sportBoardFilter": filter,
    "@/runtime/obSportCodec": codec,
    "@/runtime/obSportLive": live,
    "@/runtime/obSportApiError": { ObSportApiError },
  };
  const modules = new Map<string, { exports: any }>();
  function load(name: string, source = readObRuntime(name)): any {
    const cached = modules.get(name);
    if (cached) return cached.exports;
    const module = { exports: {} }; modules.set(name, module);
    const require = (id: string) => id.startsWith("./obSportFootball") ? load(id.slice(2)) : ports[id] ?? defaults[id] ?? {};
    vm.runInContext(`(function(require, module, exports) {${compile(source)}\n})`, context)(require, module, module.exports);
    return module.exports;
  }
  const api = original ? load("original", originalObFootball) : load("obSportFootballFetch");
  return { api, load };
}

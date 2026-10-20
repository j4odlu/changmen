import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
// [changmen 扩展] 原有预检兼容性同时覆盖上游输入和提取后的公共任务，不能只比判断函数。
import { readClientPackageSource } from "./client-package-relocation.mjs";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { gitSource, moduleTokens } from "./fok-exact-boundaries.mjs";
import { restorePmSourceIsolationMetadata } from "./pm-source-isolation-metadata.mjs";
import { restorePmSportsTypeScriptSource } from "./pm-sports-typescript-boundary.mjs";

const baseline = "a233e20534395b31401828e754432407b109053d";
const pm = "packages/venue-adapter/polymarket/";
const readBeforeExecution = withAdapterHistoryReader(file => restorePmSportsTypeScriptSource(file, readClientPackageSource(file, readAdapterHistory(file, "utf8"), f => readAdapterHistory(f, "utf8")).replaceAll("\r\n", "\n")));
const read = file => restoreVenueBrowserExecution(file, readBeforeExecution(file));
const online = file => gitSource(baseline, file).replaceAll("\r\n", "\n");

const parserFile = "server/collectors/polymarket-sports/parse_sport.js";
const clockCommit = "1a0f4c0204496a3d1b9bb0e0b96c10a7f1d3a7e0";
const originalClock = "    elapsed: msg.elapsed ? String(msg.elapsed) : undefined,";
const reviewedClock = "    elapsed: msg.elapsed != null ? String(msg.elapsed) : undefined,";
// [changmen 扩展] 只还原已提交的零计时修正；完整原文件及固定历史提交仍逐字核对。
function restoreReviewedParserClock(source) {
  const original = online(parserFile);
  const committed = gitSource(clockCommit, parserFile);
  assert.equal(committed.split(reviewedClock).length, 2, "exactly one reviewed clock field");
  assert.equal(committed.replace(reviewedClock, originalClock), original, "reviewed commit changes only the zero clock field");
  if (source === original) return source;
  assert.equal(source, committed, "only the exact committed parser correction is accepted");
  return source.replace(reviewedClock, originalClock);
}

// [changmen 扩展] 仅移除赛果存档的两个新增类型片段；所有原字段仍逐字对照同一历史基线。
function restoreReviewedOutcomeArchiveContract(file, source) {
  if (file !== "packages/api-contract/src/dto.ts" || source === online(file)) return source;
  for (const fragment of [
    `export interface PolymarketOutcomeEntry extends PolymarketMarketIndexEntry {
  firstSeenAt: number;
  lastCheckedAt?: number;
  nextCheckAt?: number;
}

`,
    `  /** [changmen 扩展] 独立赛果补采队列/存档；不加入行情 assets 或下注盘口。 */
  outcomeEntries?: PolymarketOutcomeEntry[];
`,
  ]) {
    assert.equal(source.split(fragment).length, 2, "exact optional outcome archive contract addition");
    source = source.replace(fragment, "");
  }
  return source;
}

describe("legacy FOK retains the deployed sports input pipeline", () => {
  it.each([
    "server/collectors/polymarket-sports/index.js",
    "server/collectors/polymarket-sports/gamma_poll.js",
    "server/collectors/polymarket-sports/sport_state.js",
    "server/collectors/polymarket-sports/parse_sport.js",
    "server/collectors/polymarket-sports/package.json",
    "server/db/rds/pm_sport_store.js",
    "server/db/package.json",
    "packages/api-contract/src/dto.ts",
    "packages/client-core/src/models/match.ts",
    "packages/shared/package.json",
    "package-lock.json",
  ])("%s restores the complete fixed historical source after exact reviewed changes", file => {
    // [changmen 扩展] 仅逆向登记的包迁移，仍逐字比较原固定历史源码；其余文件不做变换。
    const source = file === parserFile ? restoreReviewedParserClock(read(file)) : restoreReviewedOutcomeArchiveContract(file, read(file));
    expect(restorePmSourceIsolationMetadata(file, source, online(file))).toBe(online(file));
  });

  it("accepts only the exact optional archive DTO addition and retains the complete historical contract", () => {
    const file = "packages/api-contract/src/dto.ts";
    const original = online(file), current = read(file);
    expect(restoreReviewedOutcomeArchiveContract(file, original)).toBe(original);
    expect(restoreReviewedOutcomeArchiveContract(file, current)).toBe(original);
    for (const changed of [
      current.replace("outcomeEntries?:", "outcomeEntries:"),
      current.replace("nextCheckAt?: number;", "nextCheckAt?: string;"),
      current.replace("outcomeEntries?: PolymarketOutcomeEntry[];", "outcomeEntries?: PolymarketOutcomeEntry[];\n  outcomeEntries?: PolymarketOutcomeEntry[];"),
      current.replace("assetIds: string[];", "assetIds: number[];"),
      current + "\nexport const unreviewedGate = true;\n",
    ]) expect(() => assert.equal(restoreReviewedOutcomeArchiveContract(file, changed), original)).toThrow();
    const options = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 };
    expect(ts.transpileModule(current, { compilerOptions: options }).outputText)
      .toBe(ts.transpileModule(original, { compilerOptions: options }).outputText);
  });

  it("accepts both exact parser forms while retaining the original historical baseline", () => {
    expect(baseline).toBe("a233e20534395b31401828e754432407b109053d");
    expect(restoreReviewedParserClock(online(parserFile))).toBe(online(parserFile));
    expect(restoreReviewedParserClock(gitSource(clockCommit, parserFile))).toBe(online(parserFile));
  });

  it.each([
    ["extra source", source => `${source}\n`],
    ["clock semantics", source => source.replace(reviewedClock, "    elapsed: String(msg.elapsed),")],
    ["timestamp semantics", source => source.replace("updatedAt: Date.now(),", "updatedAt: 0,")],
    ["duplicate clock field", source => source.replace(reviewedClock, `${reviewedClock}\n${reviewedClock}`)],
  ])("rejects unreviewed parser %s", (_label, mutate) => {
    expect(() => restoreReviewedParserClock(mutate(gitSource(clockCommit, parserFile)))).toThrow("exact committed parser correction");
  });

  it.each(["markets/pmSportGamma.ts", "submission/preflight/pmBetGuard.ts"])("legacy %s still matches the current online module", file => {
    const legacyFile = file.endsWith("pmSportGamma.ts") ? "pmSportGamma.ts" : "pmBetGuard.ts";
    const tokens = source => moduleTokens(source.replace(/from\s+(["'])(?:\.\.\/|\.\/)[^"']+\1/g, 'from "relative-import"'));
    expect(tokens(read(pm + "submission/preflight/legacy/" + legacyFile))).toEqual(tokens(online(pm + file)));
  });

  it("keeps WS ownership and delayed-frame freshness identical for legacy inputs", () => {
    // Native Node executes both real state writers; no DB, WS, or platform requests.
    const stateFile = "server/collectors/polymarket-sports/sport_state.js";
    const parser = pathToFileURL(path.resolve("server/collectors/polymarket-sports/parse_sport.js")).href;
    const source = online(stateFile).replace('"./parse_sport.js"', JSON.stringify(parser));
    const program = `
      import assert from 'node:assert/strict';
      const old = await import('data:text/javascript;base64,' + Buffer.from(${JSON.stringify(source)}).toString('base64'));
      const current = await import(${JSON.stringify(pathToFileURL(path.resolve(stateFile)).href)});
      const now = 1800000000000;
      const frame = {gameId:1,status:'running',live:true,ended:false,period:'1/3',score:'000-000|0-0|Bo3'};
      async function scenario(module, delayed) {
        let stored = null;
        const apply = module.createPmSportStateWriter(async()=>stored);
        const write = async(_id,s)=>{stored=s;return true;};
        Date.now=()=>now;
        await apply(1,frame,'ws',write,delayed ? now-60000 : now);
        if (delayed) return {updatedAt:stored.updatedAt, stale:now-stored.updatedAt>45000};
        Date.now=()=>now+1000;
        const accepted=await apply(1,{...frame,ended:true,live:false,status:'finished'},'gamma',write,now+1000);
        return {accepted,ended:stored.ended,source:stored.source};
      }
      for (const delayed of [false,true]) {
        const expected=await scenario(old,delayed);
        assert.deepEqual(await scenario(current,delayed),expected);
        assert.deepEqual(expected,delayed ? {updatedAt:now,stale:false} : {accepted:false,ended:false,source:'ws'});
      }
    `;
    expect(() => execFileSync(process.execPath, ["--input-type=module", "-e", program], { stdio: "pipe", windowsHide: true })).not.toThrow();
  });
});

function compile(source, bindings) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function(...Object.keys(bindings), "exports", code)(...Object.values(bindings), exports);
  return exports;
}

// Read the actual deployed parallel block rather than reproducing its algorithm in the test.
const deployedFok = online(pm + "fok/bet.ts");
const start = deployedFok.indexOf("      const buyP =");
const end = deployedFok.indexOf('      if (guardSettled.status === "fulfilled"', start);
if (start < 0 || end < start) throw new Error("Deployed preflight task block missing");
const deployedTasks = `export async function run() { ${deployedFok.slice(start, end)}
  return {market:buySettled,guard:guardSettled,clock:clockSettled,runtime:runtimeSettled}; }`;
const commonSource = read(pm + "submission/preflight/pmBuyPreflight.ts");
const commonAst = ts.createSourceFile("common.ts", commonSource, ts.ScriptTarget.Latest, true);
const commonTasks = commonAst.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(commonAst)).join("\n");

async function runTasks(version, role, failure) {
  const calls = [];
  const account = { token: "ready-token" }, option = { itemId: "token" };
  const action = name => async () => {
    calls.push(name);
    if (failure === name || failure === "all") throw new Error(name + " failed");
    return name === "guard" ? "market blocked" : name === "clock" ? undefined : { price: 0.5 };
  };
  const market = action("market"), guard = action("guard"), clock = action("clock");
  const readyRuntime = { runtime: "prepared", cacheHit: true };
  const prepareRuntime = () => {
    calls.push("runtime");
    if (failure === "runtime" || failure === "all") throw new Error("runtime failed");
    return readyRuntime;
  };
  const bindings = {
    account, option, context: { role }, gateway: "gateway", tokenId: "token", detectionOdds: 2, apiBetMoney: 10, maxPrice: 0.5,
    resolvePolymarketExecutableBuy: market, resolvePolymarketBetBlockReason: version === "online" ? guard : () => { throw new Error("optimized guard must not run"); },
    resolveLegacyBlockReason: guard, pmPrepareSubmit: clock,
    measurePmExecution: (_kind, _fields, action) => action(),
    parseTokenConfig: () => ({}), resolveApiCreds: () => ({ address: "a", apiKey: "k", secret: "s", passphrase: "p", signatureType: 2 }),
    resolvePrivateKey: () => "private", preparationBinding: () => "bound", polymarketSigningGeneration: () => 7,
    polymarketSigningSessionGeneration: () => 7,
    preparePolymarketOrderClientRuntime: prepareRuntime,
    resolveSdkSignatureType: value => [1, 2, 3].includes(Number(value)) ? Number(value) : 0,
    // The legacy cold-signer compatibility fix prepares once, then verifies that the same cached runtime survived.
    getPolymarketOrderClientRuntime: version === "online" ? prepareRuntime : () => readyRuntime,
    getPolymarketPmSportBlockReasonFromOption: () => { throw new Error("legacy must not add a post-await sport check"); },
  };
  const loaded = compile(version === "online" ? deployedTasks : commonTasks, bindings);
  const result = version === "online" ? await loaded.run() : await loaded.runPmBuyPreflight(account, option, {
    gateway: "gateway", market, role, sportMode: "legacy", requireClobConfirmation: true,
    runtimeBinding: () => "bound", missingCredentialsMessage: "missing", measureStages: true,
  });
  return { calls, result: Object.fromEntries(Object.entries(result).map(([key, value]) => [key,
    value.status === "rejected" ? { status: value.status, reason: value.reason.message } : value])) };
}

describe.each(["execute", "precheckOnly"])("legacy common tasks match the deployed %s path with a ready wallet", role => {
  it.each(["none", "market", "guard", "clock", "runtime", "all"])("preserves start order and settled outcomes when %s fails", async failure => {
    expect(await runTasks("candidate", role, failure)).toEqual(await runTasks("online", role, failure));
  });
});

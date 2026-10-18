import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import ts from "typescript";
import baseline from "./typescript-runtime-baseline.json" with { type: "json" };

it("public exports typecheck in a separate strict consumer without collector tsconfig includes", () => {
  const file = fileURLToPath(new URL("./external-consumer.fixture.ts", import.meta.url));
  const source = `
    import type {} from "@changmen/polymarket-esports-collector";
    import { runPolymarketEsportsDiscoveryCycle } from "@changmen/polymarket-esports-collector/loop.js";
    import { buildPolymarketMappedMarket } from "@changmen/polymarket-esports-collector/parse.js";
    void runPolymarketEsportsDiscoveryCycle;
    void buildPolymarketMappedMarket;
  `;
  const options = {
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true,
    allowImportingTsExtensions: true, resolveJsonModule: true, types: ["node"],
  };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile, originalExists = host.fileExists;
  const isFixture = path => path.replaceAll("\\", "/") === file.replaceAll("\\", "/");
  host.readFile = path => isFixture(path) ? source : originalRead(path);
  host.fileExists = path => isFixture(path) || originalExists(path);
  const program = ts.createProgram([file], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
});

// This is a collector migration check; the independent FOK baseline is unchanged.
for (const [name, hash] of Object.entries(baseline.hashes)) {
  it(`${name}.ts erases to the pre-migration implementation`, () => {
    assert.equal(ts.version, baseline.compiler);
    const source = fs.readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8");
    const runtime = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true },
    }).outputText.replace(/(from\s+|import\s+)(["'])\.\/(api|parse|loop|market_index)\.ts\2/g, "$1$2./$3.js$2");
    assert.equal(createHash("sha256").update(runtime).digest("hex"), hash);
  });
  if (name !== "index") it(`${name}.js exposes the same TS exports`, async () => {
    const legacy = await import(`./${name}.js`);
    const typed = await import(`./${name}.ts`);
    assert.deepEqual(Object.keys(legacy), Object.keys(typed));
    for (const key of Object.keys(typed)) assert.equal(legacy[key], typed[key]);
  });
}

it("the unchanged PM2 JS entry boots and shuts down through native Node TS", () => {
  // Replace only external service boundaries. Never load credentials or connect
  // to RDS/the venue when exercising the actual index.js -> index.ts bootstrap.
  const entry = new URL("./index.js", import.meta.url).href;
  const script = `
    import { registerHooks } from "node:module";
    const modules = {
      "@changmen/db": 'export const hasDatabaseUrlConfig=()=>true; export const initDatabaseUrl=async()=>null; export const getResolvedDatabaseLabel=()=>"test";',
      "@changmen/storage/load_env.js": 'export const loadChangmenEnv=()=>{};',
      "./loop.ts": 'export const runPolymarketEsportsDiscoveryCycle=async()=>({skipped:false,matches:1,bets:2,writePlatform:true,collectTypes:["moneyline"]});',
    };
    registerHooks({resolve(spec,context,next){
      if(Object.hasOwn(modules,spec))return {url:"data:text/javascript,"+encodeURIComponent(modules[spec]),shortCircuit:true};
      return next(spec,context);
    }});
    const realSetInterval=globalThis.setInterval;
    globalThis.setInterval=(fn,delay)=>{if(delay!==60000)throw Error("interval changed");return realSetInterval(fn,delay);};
    await import(${JSON.stringify(entry)});
    await new Promise(resolve=>setImmediate(resolve));
    process.emit("SIGTERM");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8", windowsHide: true, timeout: 10_000,
    env: { ...process.env, POLYMARKET_COLLECTOR_INTERVAL_MS: "60000" },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /cycle ok mode=live matches=1 bets=2/);
});

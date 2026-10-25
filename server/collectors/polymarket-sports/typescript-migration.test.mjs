import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import ts from "typescript";
import baseline from "./typescript-runtime-baseline.json" with { type: "json" };

// [changmen 扩展] Type erasure is checked for every implementation, independent
// of the unchanged historical sports input and 551-file FOK proofs.
for (const [name, hash] of Object.entries(baseline.hashes)) {
  it(`${name}.ts erases to the accepted pre-migration implementation`, () => {
    assert.equal(ts.version, baseline.compiler);
    let source = fs.readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
    // [changmen 扩展] 只逆转 PM 原生场次状态的精确接入，原 TS 迁移摘要不变。
    const eventStateHooks = name === "index" ? [
      ['import { persistSourceEventStates } from "./event_states.ts";\n', ""],
      ['    await persistSourceEventStates(gammaIndex.sportMessages || [], "gamma")\n      .catch(err => console.warn("[pm-sports] event Gamma state:", (err as Error).message));\n', ""],
      ['  const sourceMessage = withGammaSportIdentity(msg, gammaIndex);\n  await persistSourceEventStates([sourceMessage], "ws")\n    .catch(err => console.warn("[pm-sports] event WS state:", (err as Error).message));\n', ""],
    ] : name === "gamma_map" ? [
      ["  const sportMessages: SportMessage[] = [];\n", ""],
      ["      const sport = gammaEventToSportMessage(event);\n      if (sport) sportMessages.push(sport);\n", ""],
      ["  return { byGameId, bySlug, sportMessages };", "  return { byGameId, bySlug };"],
    ] : [];
    for (const [after, before] of eventStateHooks) {
      assert.equal(source.split(after).length, 2, `missing/duplicate event state hook: ${name}`);
      source = source.replace(after, before);
    }
    const runtime = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, removeComments: true },
    }).outputText.replace(/(from\s+|import\s+)(["'])\.\/(index|gamma_map|gamma_poll|sport_state|resolve_match|parse_sport|prematch_prices|broadcast_notify)\.ts\2/g, "$1$2./$3.js$2");
    assert.equal(createHash("sha256").update(runtime).digest("hex"), hash);
  });
  if (name !== "index") it(`${name}.js forwards the same exports`, async () => {
    const legacy = await import(`./${name}.js`);
    const typed = await import(`./${name}.ts`);
    assert.deepEqual(Object.keys(legacy), Object.keys(typed));
    for (const key of Object.keys(typed)) assert.equal(legacy[key], typed[key]);
  });
}

it("both PM packages and canonical storage declarations compile in one isolated strict consumer", () => {
  const file = fileURLToPath(new URL("./external-consumer.fixture.ts", import.meta.url));
  const source = `
    import type {} from "@changmen/polymarket-sports";
    import {buildPmSportSnapshot} from "@changmen/polymarket-sports/parse_sport.js";
    import {refreshGammaEventIndex} from "@changmen/polymarket-sports/gamma_map.js";
    import {runPolymarketEsportsDiscoveryCycle} from "@changmen/polymarket-esports-collector/loop.js";
    import {readPolymarketMarketIndex} from "@changmen/storage/polymarket_market_index.js";
    import {loadChangmenEnv} from "@changmen/storage/load_env.js";
    void [buildPmSportSnapshot,refreshGammaEventIndex,runPolymarketEsportsDiscoveryCycle,readPolymarketMarketIndex,loadChangmenEnv];
  `;
  const options = {
    target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true,
    allowImportingTsExtensions: true, resolveJsonModule: true, types: ["node"],
  };
  const host = ts.createCompilerHost(options), originalRead = host.readFile, originalExists = host.fileExists;
  const fixture = path => path.replaceAll("\\", "/") === file.replaceAll("\\", "/");
  host.readFile = path => fixture(path) ? source : originalRead(path);
  host.fileExists = path => fixture(path) || originalExists(path);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
  assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), []);
});

it("the original PM2 entry boots, handles a WS frame, persists and broadcasts before shutdown", () => {
  const entry = new URL("./index.js", import.meta.url).href;
  const script = `
    import assert from "node:assert/strict";
    import {registerHooks} from "node:module";
    const state={intervals:[],writes:[],broadcasts:[],schema:false,sourceWrites:[]};
    globalThis.__pmSportBoot=state;
    const modules={
      "@changmen/db":
        'const state=globalThis.__pmSportBoot; export const hasDatabaseUrlConfig=()=>true; export const initDatabaseUrl=async()=>null; export const getResolvedDatabaseLabel=()=>"test"; export const ensurePmPrematchSchema=async()=>{state.schema=true;}; export const writePlatformPmSports=async snapshots=>{state.sourceWrites.push(...snapshots);return snapshots.length;}; export const updateClientMatchPmSport=async(id,s)=>{state.writes.push([id,s]);return true;}; export const fetchLinkedPolymarketPlatformMatches=async()=>[]; export const fetchPmSportByClientMatchIds=async()=>new Map(); export const resolveClientMatchIdForPmSport=async query=>query.slug==="unmatched"?null:11; export const fetchPmPrematchPrices=async()=>({}); export const writePmPrematchPrices=async()=>{};',
      "@changmen/storage/load_env.js": 'export const loadChangmenEnv=()=>{};',
      "./gamma_map.ts":
        'export const refreshGammaEventIndex=async()=>({byGameId:new Map(),bySlug:new Map()}); export const withGammaSportIdentity=m=>m; export const gammaEventToSportMessage=m=>m; export const fetchGammaEventById=async()=>null; export const fetchGammaEventByGameId=async()=>null; export const fetchGammaEventBySlug=async()=>null; export const rememberGammaEvent=()=>{};',
      "ws": 'import {EventEmitter} from "node:events"; export default class WebSocket extends EventEmitter {constructor(url){super();this.url=url;globalThis.__pmSportBoot.ws=this;}close(){this.emit("close");}send(){}}',
    };
    registerHooks({resolve(spec,context,next){if(Object.hasOwn(modules,spec))return {url:"data:text/javascript,"+encodeURIComponent(modules[spec]),shortCircuit:true};return next(spec,context);}});
    globalThis.setInterval=(fn,ms)=>{state.intervals.push(ms);return 1;};
    globalThis.fetch=async(url,init)=>{assert.equal(new URL(String(url)).pathname,"/esport/internal/broadcast/pm-sport");state.broadcasts.push(JSON.parse(init.body));return Response.json({ok:true});};
    await import(${JSON.stringify(entry)});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(state.schema,true);
    assert.deepEqual(state.intervals,[60000,60000,60000]);
    assert.equal(state.ws.url,"wss://sports-api.polymarket.com/ws");
    state.ws.emit("message",Buffer.from(JSON.stringify({gameId:123,eventId:"pm1",slug:"fixture",live:true,status:"running",score:"0-0|1-0|Bo3",period:"2/3",elapsed:0})));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(state.writes.length,1);
    assert.equal(state.writes[0][0],11);
    assert.equal(state.writes[0][1].source,"ws");
    assert.equal(state.writes[0][1].elapsed,"0");
    assert.deepEqual(state.writes[0][1].mapScore,{home:1,away:0});
    assert.equal(state.broadcasts[0].clientMatchId,11);
    assert.deepEqual(state.broadcasts[0].pmSport,JSON.parse(JSON.stringify(state.writes[0][1])));
    state.ws.emit("message",Buffer.from(JSON.stringify({gameId:456,eventId:"pm2",slug:"unmatched",status:"running",live:true})));
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(state.sourceWrites.map(row=>row.eventId),["pm1","pm2"]);
    assert.equal(state.writes.length,1);
    assert.equal(state.broadcasts.length,1);
    console.log("pm-sports native TS boot, WS, storage and broadcast OK");
    process.emit("SIGTERM");
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8", timeout: 10_000, windowsHide: true,
    env: { ...process.env, CHANGMEN_PM_SPORT_BROADCAST_URL: "http://127.0.0.1:1/esport/internal/broadcast/pm-sport" },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pm-sports native TS boot, WS, storage and broadcast OK/);
});

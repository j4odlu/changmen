import assert from "node:assert/strict";
import { it } from "node:test";
import { spawnSync } from "node:child_process";
import { mergePolymarketOutcomeEntries, refreshPolymarketOutcomes } from "./outcomes.ts";

const now = 1_800_000_000_000;
const minute = 60_000;
const day = 24 * 60 * minute;
const entry = (map = 2, extra = {}) => ({
  sourceMatchId: "ended-event", marketId: `map-${map}`, sourceBetId: `map-${map}`, map,
  homeTokenId: `h${map}`, awayTokenId: `a${map}`, homeName: "EYEBALLERS", awayName: "Team Nemesis",
  homeOdds: 3, awayOdds: 1.5, status: "Normal", startTime: now - 3 * 60 * minute, ...extra,
});

it("backfills a removed map's official winner and leaves the unresolved decider pending without touching quotes", async () => {
  const archive = mergePolymarketOutcomeEntries([], [entry(), entry(0)], now);
  let index = { updatedAt: now - minute, entries: [], assetIds: [], outcomeEntries: archive };
  const deps = { readIndex: () => index, writeIndex: value => { index = value; }, nowMs: now,
    fetchOfficial: async markets => markets.map(market => ({ ...market, tokens: market.conditionId === "map-2"
      ? [{ token_id: "a2", winner: true }, { token_id: "h2", winner: false }]
      : [{ token_id: "h0", winner: false }, { token_id: "a0", winner: false }],
    })) };
  assert.deepEqual(await refreshPolymarketOutcomes(deps), { queried: 2, resolved: 1 });
  assert.equal(index.outcomeEntries.find(e => e.map === 2).mapOutcome, "away");
  assert.equal(index.outcomeEntries.find(e => e.map === 2).outcomeKind, "official");
  assert.equal(index.outcomeEntries.find(e => e.map === 0).mapOutcome, undefined);
  assert.deepEqual(index.entries, []);
  assert.deepEqual(index.assetIds, []);
  assert.ok(index.outcomeEntries.every(e => e.status === "Locked" && !e.homeOdds && !e.awayOdds));
  assert.deepEqual(await refreshPolymarketOutcomes(deps), { queried: 0, resolved: 0 }, "retry schedule survives reading persisted state");
  let requested;
  await refreshPolymarketOutcomes({ ...deps, nowMs: now + minute,
    fetchOfficial: async markets => { requested = markets; return markets; } });
  assert.deepEqual(requested.map(m => m.conditionId), ["map-0"], "official winner is not queried again");
});

it("keeps official results through discovery missing values and prices, but not token identity changes", () => {
  const official = { ...entry(), firstSeenAt: now, mapOutcome: "away", outcomeKind: "official" };
  const [retained] = mergePolymarketOutcomeEntries([official], [entry(2, { homeClobPrice: .999 })], now);
  assert.equal(retained.mapOutcome, "away");
  assert.equal(retained.outcomeKind, "official");
  assert.equal(retained.homeClobPrice, undefined);
  const [changed] = mergePolymarketOutcomeEntries([official], [entry(2, { homeTokenId: "other" })], now);
  assert.equal(changed.mapOutcome, undefined);
});

it("bounds requests, rotates oldest checks first, skips future starts, and retains no result from failed queries", async () => {
  const entries = Array.from({ length: 55 }, (_, i) => entry(i));
  entries.push(entry(99, { startTime: now + minute }));
  let index = { updatedAt: now, assetIds: ["live"], entries };
  const queries = [];
  const deps = { readIndex: () => index, writeIndex: value => { index = value; }, nowMs: now,
    fetchOfficial: async markets => { queries.push(markets); return markets.map(m => ({ ...m, tokens: [] })); } };
  assert.equal((await refreshPolymarketOutcomes(deps)).queried, 48);
  assert.equal((await refreshPolymarketOutcomes(deps)).queried, 7);
  assert.equal(queries.flat().some(m => m.conditionId === "map-99"), false);
  assert.equal(new Set(queries.flat().map(m => m.conditionId)).size, 55);
  assert.ok(index.outcomeEntries.every(e => !e.mapOutcome));
  assert.equal(index.entries, entries);
  assert.deepEqual(index.assetIds, ["live"]);
});

it("expires pending after seven days and official results after thirty days without refreshing their age", () => {
  const pending = entry(0, { startTime: now - 8 * day, firstSeenAt: now - 8 * day });
  const official = entry(1, { startTime: now - 8 * day, firstSeenAt: now - 8 * day, mapOutcome: "home", outcomeKind: "official" });
  assert.deepEqual(mergePolymarketOutcomeEntries([pending, official], [], now), [official]);
  assert.deepEqual(mergePolymarketOutcomeEntries([official], [official], now + 30 * day), []);
  const missingStart = entry(2, { startTime: undefined });
  const seeded = mergePolymarketOutcomeEntries([], [missingStart], now);
  assert.deepEqual(mergePolymarketOutcomeEntries(seeded, [missingStart], now + 8 * day), []);
});

it("discovery persists and removes live markets without losing the independent result archive", () => {
  const outcomesUrl = new URL("./outcomes.ts", import.meta.url).href;
  const indexUrl = new URL("./market_index.ts", import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    const storage = 'export const readPolymarketMarketIndex=()=>globalThis.testIndex; export const writePolymarketMarketIndex=index=>{globalThis.testIndex=index};';
    registerHooks({resolve(spec,ctx,next){return spec==='@changmen/storage/polymarket_market_index'
      ? {url:'data:text/javascript,'+encodeURIComponent(storage),shortCircuit:true} : next(spec,ctx);}});
    const {persistPolymarketMarketIndex}=await import(${JSON.stringify(indexUrl)});
    const {refreshPolymarketOutcomes}=await import(${JSON.stringify(outcomesUrl)});
    const candidate={marketId:'m',assetIds:['h','a'],match:{SourceMatchID:'e',StartTime:Date.now()-1000},
      bet:{SourceBetID:'m',Map:2,HomeName:'H',AwayName:'A',HomeOdds:2,AwayOdds:2,Status:'Normal'}};
    persistPolymarketMarketIndex([candidate],{h:.5,a:.5},{});
    assert.equal(globalThis.testIndex.outcomeEntries.length,1);
    await refreshPolymarketOutcomes({fetchOfficial:async rows=>rows.map(row=>({...row,tokens:[{token_id:'a',winner:true}]}))});
    // discovery 暂时缺胜方不能清掉已补到的官方结果。
    persistPolymarketMarketIndex([candidate],{},{});
    assert.equal(globalThis.testIndex.outcomeEntries[0].mapOutcome,'away');
    persistPolymarketMarketIndex([],{}, {removeSourceMatchIds:['e']});
    assert.deepEqual(globalThis.testIndex.entries,[]);
    assert.deepEqual(globalThis.testIndex.assetIds,[]);
    assert.equal(globalThis.testIndex.outcomeEntries[0].mapOutcome,'away');
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8", windowsHide: true, timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

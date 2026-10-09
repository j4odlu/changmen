import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runPolymarketEsportsDiscoveryCycle as runDiscovery } from "./loop.js";

// 现有写库安全测试不访问外部服务；官方结果入口由下方集成用例单独验证。
function runPolymarketEsportsDiscoveryCycle(deps) {
  return runDiscovery({
    fetchOfficialMarkets: async markets => markets,
    ...deps,
  });
}

const MONEYLINE_TYPES = new Set(["moneyline", "child_moneyline"]);

describe("polymarket-esports write safety", () => {
  it("queries CLOB before mapping, preserves closed map winners, and prices only open markets", async () => {
    const base = { sportsMarketType: "child_moneyline", groupItemTitle: "Map 1 Winner", gameStartTime: Date.now() - 3600_000, clobTokenIds: "[\"h\",\"a\"]", outcomes: "[\"STATE\",\"Teletubisie\"]", events: [{ id: "evt", slug: "cs2-sta-ttbs" }], outcomePrices: "[\"1\",\"0\"]" };
    let queried;
    let indexed;
    let bets;
    const stats = await runPolymarketEsportsDiscoveryCycle({
      writePlatform: true,
      resolveTypes: async () => MONEYLINE_TYPES,
      fetchMarkets: async () => ({ markets: [
        { ...base, conditionId: "closed-map", closed: true },
        { ...base, conditionId: "unresolved-closed", closed: true },
        { ...base, conditionId: "open-map", closed: false, clobTokenIds: "[\"h2\",\"a2\"]" },
      ], rawEventCount: 1, rawMarketCount: 3 }),
      fetchOfficialMarkets: async (markets) => {
        queried = markets.map(m => m.conditionId);
        return markets.map(m => ({ ...m, tokens: m.conditionId === "closed-map"
          ? [{ token_id: "a", winner: true }]
          : [] }));
      },
      fetchPrices: async (ids) => {
        assert.deepEqual(ids, ["h2", "a2"]);
        return { h2: 0.999, a2: 0.001 };
      },
      writeMatches: () => {},
      replaceBets: (_p, _sid, rows) => { bets = rows; },
      pruneMatches: async () => [],
      persistIndex: (rows) => { indexed = rows; },
    });
    assert.equal(stats.bets, 2);
    assert.deepEqual(queried, ["closed-map", "unresolved-closed", "open-map"]);
    assert.equal(indexed[0].mapOutcome, "away");
    assert.equal(indexed[0].outcomeKind, "official");
    assert.equal(indexed[1].mapOutcome, undefined, "price 1 does not generate a winner");
    assert.equal(bets[0].Status, "Locked");
    assert.equal(bets[0].HomeOdds, 0);
  });

  it("shadow mode never writes platform_*", async () => {
    const writes = [];
    const stats = await runPolymarketEsportsDiscoveryCycle({
      writePlatform: false,
      resolveTypes: async () => MONEYLINE_TYPES,
      fetchMarkets: async () => ({
        markets: [],
        rawEventCount: 0,
        rawMarketCount: 0,
        excludeSourceMatchIds: [],
      }),
      fetchPrices: async () => ({}),
      writeMatches: () => writes.push("matches"),
      replaceBets: () => writes.push("bets"),
      pruneMatches: async () => {
        writes.push("prune");
        return [];
      },
      persistIndex: (c, _p, opts) => writes.push(["index", c.length, opts?.removeSourceMatchIds?.length ?? 0]),
    });
    assert.equal(stats.shadow, true);
    assert.deepEqual(writes, [["index", 0, 0]]);
  });

  it("empty window prunes ended/stale only (no start-window wipe, no empty index wipe)", async () => {
    const writes = [];
    const pruneCalls = [];
    const now = Date.now();
    const stats = await runPolymarketEsportsDiscoveryCycle({
      writePlatform: true,
      nowMs: now,
      resolveTypes: async () => MONEYLINE_TYPES,
      fetchMarkets: async () => ({
        markets: [{
          condition_id: "x",
          sportsMarketType: "spread",
          clob_token_ids: "[\"a\",\"b\"]",
          outcomes: "[\"A\",\"B\"]",
          active: true,
          events: [{ id: "e1" }],
          tags: [{ slug: "lol" }],
        }],
        rawEventCount: 1,
        rawMarketCount: 1,
        excludeSourceMatchIds: ["ended-9"],
      }),
      fetchPrices: async () => ({}),
      writeMatches: (p, rows) => writes.push(["matches", p, rows.length]),
      replaceBets: () => writes.push(["bets"]),
      pruneMatches: async (opts) => {
        pruneCalls.push(opts);
        return ["ended-9"];
      },
      persistIndex: (c, _p, opts) => writes.push([
        "index",
        c.length,
        [...(opts?.removeSourceMatchIds || [])].sort(),
      ]),
    });
    assert.equal(stats.skipped, false);
    assert.equal(stats.pruned, 1);
    // prune first, then index with removeIds — never hard-clear via bare []
    assert.deepEqual(writes, [["index", 0, ["ended-9"]]]);
    assert.equal(pruneCalls.length, 1);
    assert.deepEqual(pruneCalls[0].forceDeleteIds, ["ended-9"]);
    assert.equal(pruneCalls[0].staleBeforeMs, now - 48 * 3600 * 1000);
    assert.equal(pruneCalls[0].startMin, undefined);
    assert.equal(pruneCalls[0].startMax, undefined);
  });

  it("skips write when typed moneyline exists but parse yields zero", async () => {
    const writes = [];
    const stats = await runPolymarketEsportsDiscoveryCycle({
      writePlatform: true,
      resolveTypes: async () => MONEYLINE_TYPES,
      fetchMarkets: async () => ({
        markets: [{
          condition_id: "x",
          sportsMarketType: "moneyline",
          groupItemTitle: "Match Winner",
          clob_token_ids: "[\"a\",\"b\"]",
          outcomes: "[\"Yes\",\"No\"]",
          active: true,
          events: [{ id: "e1" }],
          tags: [{ slug: "lol" }],
        }],
        rawEventCount: 1,
        rawMarketCount: 1,
        excludeSourceMatchIds: [],
      }),
      fetchPrices: async () => ({}),
      writeMatches: (p, rows) => writes.push(["matches", p, rows.length]),
      replaceBets: () => writes.push(["bets"]),
      pruneMatches: async () => {
        writes.push("prune");
        return [];
      },
      persistIndex: () => writes.push(["index"]),
    });
    assert.equal(stats.skipped, true);
    assert.equal(stats.reason, "filter_empty_with_typed_ml");
    assert.deepEqual(writes, []);
  });

  it("upserts current candidates then prunes (no soft-retain backfill)", async () => {
    const now = Date.now();
    const writes = [];
    const pruneCalls = [];
    const betWrites = [];
    const stats = await runPolymarketEsportsDiscoveryCycle({
      writePlatform: true,
      nowMs: now,
      resolveTypes: async () => MONEYLINE_TYPES,
      fetchMarkets: async () => ({
        markets: [{
          condition_id: "cond-keep",
          sportsMarketType: "moneyline",
          groupItemTitle: "Match Winner",
          active: true,
          closed: false,
          gameStartTime: now + 600_000,
          clob_token_ids: "[\"h\",\"a\"]",
          outcomes: "[\"Alpha\",\"Beta\"]",
          events: [{ id: "evt-keep" }],
          tags: [{ slug: "lol" }],
        }],
        rawEventCount: 1,
        rawMarketCount: 1,
        excludeSourceMatchIds: ["ended-1"],
      }),
      fetchPrices: async () => ({ h: 0.5, a: 0.5 }),
      writeMatches: async (_p, rows) => writes.push({
        sids: rows.map(r => String(r.SourceMatchID)),
      }),
      replaceBets: async (_p, sid, bets) => betWrites.push({ sid, n: bets.length }),
      pruneMatches: async (opts) => {
        pruneCalls.push(opts);
        return [];
      },
      persistIndex: () => {},
    });
    assert.equal(stats.matches, 1);
    assert.deepEqual(writes[0]?.sids, ["evt-keep"]);
    assert.ok(!writes[0]?.sids.includes("751074"));
    assert.deepEqual(pruneCalls[0]?.forceDeleteIds, ["ended-1"]);
    assert.equal(pruneCalls[0]?.startMin, undefined);
    assert.equal(betWrites.length, 1);
  });

  it("never force-deletes a match written this cycle (ended-flutter guard)", async () => {
    // 两 pass ended 抖动：同一场既进 candidates（open pass）又进 exclude（ended pass）。
    // 兜底须把它从 forceDeleteIds 剔除，否则「先写后删」自毁、client_match ID 反复重建。
    const now = Date.now();
    const pruneCalls = [];
    const writes = [];
    const stats = await runPolymarketEsportsDiscoveryCycle({
      writePlatform: true,
      nowMs: now,
      resolveTypes: async () => MONEYLINE_TYPES,
      fetchMarkets: async () => ({
        markets: [{
          condition_id: "cond-flutter",
          sportsMarketType: "moneyline",
          groupItemTitle: "Match Winner",
          active: true,
          closed: false,
          gameStartTime: now + 600_000,
          clob_token_ids: "[\"h\",\"a\"]",
          outcomes: "[\"Alpha\",\"Beta\"]",
          events: [{ id: "evt-flutter" }],
          tags: [{ slug: "lol" }],
        }],
        rawEventCount: 1,
        rawMarketCount: 1,
        // 另一 pass 把同场当 ended 塞进 exclude
        excludeSourceMatchIds: ["evt-flutter", "really-closed"],
      }),
      fetchPrices: async () => ({ h: 0.5, a: 0.5 }),
      writeMatches: async (_p, rows) => writes.push(rows.map(r => String(r.SourceMatchID))),
      replaceBets: async () => {},
      pruneMatches: async (opts) => {
        pruneCalls.push(opts);
        return [];
      },
      persistIndex: () => {},
    });
    assert.equal(stats.matches, 1);
    assert.deepEqual(writes[0], ["evt-flutter"]);
    // 本轮写入的 evt-flutter 必须被剔除，仅剩真正 closed 的 really-closed
    assert.deepEqual(pruneCalls[0]?.forceDeleteIds, ["really-closed"]);
  });

  it("groups multiple bets per SourceMatchID into one replace (live)", async () => {
    const replaces = [];
    const now = Date.now() + 600_000;
    const base = {
      sportsMarketType: "moneyline",
      groupItemTitle: "Match Winner",
      active: true,
      closed: false,
      gameStartTime: now,
      events: [{ id: "evt-shared", title: "A vs B" }],
      tags: [{ slug: "lol", label: "LoL" }],
    };
    const stats = await runPolymarketEsportsDiscoveryCycle({
      writePlatform: true,
      resolveTypes: async () => MONEYLINE_TYPES,
      fetchMarkets: async () => ({
        markets: [
          {
            ...base,
            condition_id: "cond-ml",
            clob_token_ids: "[\"h1\",\"a1\"]",
            outcomes: "[\"Alpha\",\"Beta\"]",
          },
          {
            ...base,
            condition_id: "cond-m1",
            sportsMarketType: "child_moneyline",
            groupItemTitle: "Map 1 Winner",
            clob_token_ids: "[\"h2\",\"a2\"]",
            outcomes: "[\"Alpha\",\"Beta\"]",
          },
        ],
        rawEventCount: 1,
        rawMarketCount: 2,
        excludeSourceMatchIds: [],
      }),
      fetchPrices: async () => ({
        h1: 0.55,
        a1: 0.48,
        h2: 0.52,
        a2: 0.5,
      }),
      writeMatches: () => {},
      replaceBets: (p, sid, bets) => replaces.push({ p, sid, n: bets.length }),
      pruneMatches: async () => [],
      persistIndex: () => {},
    });
    assert.equal(stats.matches, 1);
    assert.equal(stats.bets, 2);
    assert.equal(replaces.length, 1);
    assert.equal(replaces[0].n, 2);
  });

  it("shadow mode still builds index but skips replaceBets and prune", async () => {
    const writes = [];
    const now = Date.now() + 600_000;
    const stats = await runPolymarketEsportsDiscoveryCycle({
      writePlatform: false,
      resolveTypes: async () => MONEYLINE_TYPES,
      fetchMarkets: async () => ({
        markets: [{
          condition_id: "cond-shadow",
          sportsMarketType: "moneyline",
          groupItemTitle: "Match Winner",
          active: true,
          closed: false,
          gameStartTime: now,
          clob_token_ids: "[\"h\",\"a\"]",
          outcomes: "[\"A\",\"B\"]",
          events: [{ id: "evt-shadow" }],
          tags: [{ slug: "lol" }],
        }],
        rawEventCount: 1,
        rawMarketCount: 1,
        excludeSourceMatchIds: ["ended-x"],
      }),
      fetchPrices: async () => ({ h: 0.4, a: 0.6 }),
      writeMatches: () => writes.push("matches"),
      replaceBets: () => writes.push("bets"),
      pruneMatches: async () => {
        writes.push("prune");
        return [];
      },
      persistIndex: (c, _p, opts) => writes.push([
        "index",
        c.length,
        [...(opts?.removeSourceMatchIds || [])],
      ]),
    });
    assert.equal(stats.shadow, true);
    assert.equal(stats.matches, 1);
    assert.deepEqual(writes, [["index", 1, ["ended-x"]]]);
  });
});

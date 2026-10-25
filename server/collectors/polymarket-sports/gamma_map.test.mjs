import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { getConfiguredPlatformDiscovery } from "@changmen/shared/catalog/game_catalog";
import {
  gammaEventToSportMessage,
  parseTeamsFromGammaTitle,
  refreshGammaEventIndex,
  withGammaSportIdentity,
} from "./gamma_map.js";
import { buildPmSportSnapshot } from "./parse_sport.js";

test("Gamma score index uses the same configured sport keys and series fallback as discovery", async () => {
  const originalFetch = globalThis.fetch;
  const config = getConfiguredPlatformDiscovery("Polymarket");
  const requested = [];
  try {
    globalThis.fetch = async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/sports") return Response.json([
        ...config.sportKeys.map((sport, index) => ({ sport, series: `configured-${index}` })),
        { sport: "unconfigured-fixture", series: "must-not-collect" },
      ]);
      requested.push(parsed.searchParams.getAll("series_id"));
      return Response.json({ events: [{ id: "event", slug: "lol-fixture", gameId: 123, live: true, score: "0-0|1-0|Bo3" }] });
    };
    const index = await refreshGammaEventIndex();
    assert.deepEqual(requested, [config.sportKeys.map((_, index) => `configured-${index}`)]);
    assert.equal(index.byGameId.get(123).id, "event");
    assert.equal(index.sportMessages[0].eventId, "event");
    assert.equal(index.sportMessages[0].live, true);
    assert.equal(index.sportMessages[0].score, "0-0|1-0|Bo3");
    requested.length = 0;
    globalThis.fetch = async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/sports") return Response.json([]);
      requested.push(parsed.searchParams.getAll("series_id"));
      return Response.json({ events: [] });
    };
    await refreshGammaEventIndex();
    assert.deepEqual(requested, [config.fallbackSeriesIds]);
  }
  finally { globalThis.fetch = originalFetch; }
});

test("Gamma score index consumes future configured scope without another game allowlist", async () => {
  // Evaluate only this isolated JS module with the shared discovery boundary
  // replaced; no service or credential module is executed.
  const source = ts.transpileModule(fs.readFileSync(new URL("./gamma_map.ts", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText
    .replace(/^import \{ getConfiguredPlatformDiscovery \} from "@changmen\/shared\/catalog\/game_catalog";$/m, "")
    .replace(/^export /gm, "");
  const query = vm.runInNewContext(`(() => { ${source}; return refreshGammaEventIndex; })()`, {
    getConfiguredPlatformDiscovery: () => ({ sportKeys: ["fixture-game"], fallbackSeriesIds: ["fixture-fallback"] }),
    URLSearchParams, AbortSignal, console,
    fetch: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/sports") return Response.json([{ sport: "fixture-game", series: "fixture-series" }]);
      assert.deepEqual(parsed.searchParams.getAll("series_id"), ["fixture-series"]);
      return Response.json({ events: [{ id: "fixture-event", gameId: 456 }] });
    },
  });
  assert.equal((await query()).byGameId.get(456).id, "fixture-event");
});

test("WS keeps its score and status while Gamma only supplies archive identity", () => {
  const msg = { gameId: 1711469, score: "000-000|1-1|Bo3", period: "3/3", live: true, status: "running" };
  const index = { byGameId: new Map([[1711469, {
    id: "1139328", slug: "cs2-legacy-m80", score: "12-9|0-1|Bo3", period: "2/3", ended: true,
  }]]), bySlug: new Map() };
  const enriched = withGammaSportIdentity(msg, index);
  const snapshot = buildPmSportSnapshot(enriched);
  assert.equal(snapshot.eventId, "1139328");
  assert.equal(snapshot.slug, "cs2-legacy-m80");
  assert.equal(snapshot.currentMap, 3);
  assert.deepEqual(snapshot.mapScore, { home: 1, away: 1 });
  assert.equal(snapshot.ended, false);
  assert.equal(snapshot.status, "running");
  assert.equal(msg.eventId, undefined);
  assert.equal(withGammaSportIdentity(msg, { byGameId: new Map(), bySlug: new Map() }), msg);
  assert.equal(withGammaSportIdentity({ ...msg, eventId: "ws-event", slug: "ws-slug" }, index).eventId, "ws-event");
});

test("parseTeamsFromGammaTitle", () => {
  const row = parseTeamsFromGammaTitle(
    "Valorant: Misa Esports vs Team Liquid Academy (BO3) - VCL",
  );
  assert.equal(row.home, "Misa Esports");
  assert.equal(row.away, "Team Liquid Academy");
});

test("Gamma fallback requires explicit state fields and preserves cancellation/postponement", () => {
  assert.equal(gammaEventToSportMessage({}).status, "");
  assert.equal(gammaEventToSportMessage({ live: false }).status, "");
  assert.equal(gammaEventToSportMessage({ live: false, ended: false }).status, "not_started");
  assert.equal(gammaEventToSportMessage({ live: true }).status, "running");
  assert.equal(gammaEventToSportMessage({ ended: true }).status, "finished");
  assert.equal(gammaEventToSportMessage({ status: "postponed", live: false, ended: false }).status, "postponed");
  assert.equal(gammaEventToSportMessage({ status: "canceled", ended: true }).status, "canceled");
});

test("gammaEventToSportMessage maps live score without inferring map winners", () => {
  const event = {
    gameId: 1534520,
    slug: "val-mis-tla",
    title: "Valorant: Misa Esports vs Team Liquid Academy (BO3)",
    score: "0-0|1-1|Bo3",
    period: "3/3",
    live: true,
    ended: false,
    resolutionSource: "https://www.twitch.tv/valorant_tur",
    markets: [
      {
        sportsMarketType: "child_moneyline",
        groupItemTitle: "Map 1 Winner",
        outcomes: "[\"Misa Esports\", \"Team Liquid Academy\"]",
        outcomePrices: "[\"0.0005\", \"0.9995\"]",
      },
    ],
  };
  const msg = gammaEventToSportMessage(event);
  assert.equal(msg?.status, "running");
  assert.equal(msg?.maps, undefined);
  const snap = buildPmSportSnapshot(msg);
  assert.match(snap.label || "", /进行中 · 3\/3 · 1-1/);
  assert.match(snap.label || "", /来源 twitch\.tv/);
  assert.equal(snap.label?.includes("图1"), false);
});

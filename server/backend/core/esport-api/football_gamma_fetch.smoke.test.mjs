/**
 * 足球 Gamma 全量拉取（tag 100350）：按 PM 官网足球页同口径拉取，白名单外联赛挂 unknown_fb。
 * 用法：node server/backend/core/esport-api/football_gamma_fetch.smoke.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FOOTBALL_OPTS } from "./football_gamma_fetch.js";
import { clearSportGammaCache, fetchSportAsClientMatchDtos } from "./sport_gamma_fetch.js";
import { clearSportListCache, sportListCachePath } from "./sport_list_cache.js";

const KEY = "fbtagsmoke";
const origFetch = globalThis.fetch;

function ev(id, title, sport, startMs, seriesTitle = "") {
  return {
    id,
    title,
    startTime: new Date(startMs).toISOString(),
    sport: sport ? { sport } : undefined,
    series: seriesTitle ? [{ id: 9000 + id, title: seriesTitle, slug: sport }] : [],
    markets: [{
      sportsMarketType: "moneyline",
      active: true,
      closed: false,
      acceptingOrders: true,
      question: title,
      outcomes: '["Home FC","Away FC"]',
      outcomePrices: '["0.55","0.45"]',
      clobTokenIds: '["11","22"]',
    }],
  };
}

function restore() {
  globalThis.fetch = origFetch;
  clearSportGammaCache(KEY);
  clearSportListCache(KEY);
  const dir = path.dirname(sportListCachePath(KEY));
  fs.rmSync(dir, { recursive: true, force: true });
}

const now = Date.now();
const keysetUrls = [];
const EVENTS = [
  ev(1, "Arsenal vs Chelsea", "epl", now + 3600e3, "Premier League"),
  ev(2, "Seoul vs Busan", "kor", now + 3600e3, "K-league"), // 白名单外 → unknown_fb
  ev(3, "Argentina vs Brazil", "copaam", now + 7200e3, "Copa America"), // 美洲杯别名 → copa
  ev(4, "Club X vs Club Y", "col", now + 7200e3, "UEFA Conference League"), // 欧协联 → uecl
];

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/events/keyset")) {
    keysetUrls.push(u);
    assert.ok(u.includes("tag_id=100350"), "keyset 必须带 tag_id=100350");
    assert.ok(!u.includes("series_id"), "tag 拉取不得带 series_id 白名单");
    return { ok: true, json: async () => EVENTS };
  }
  if (u.includes("/prices"))
    return { ok: true, json: async () => ({}) };
  throw new Error(`unexpected fetch: ${u}`);
};

try {
  const rows = await fetchSportAsClientMatchDtos({ ...FOOTBALL_OPTS, cacheKey: KEY });
  assert.equal(rows.length, 4, `应有 4 场，实际 ${rows.length}`);
  const byTitle = new Map(rows.map(r => [r.Title, r.Game]));
  assert.equal(byTitle.get("Arsenal vs Chelsea"), "epl");
  assert.equal(byTitle.get("Seoul vs Busan"), "unknown_fb");
  assert.equal(byTitle.get("Argentina vs Brazil"), "copa");
  assert.equal(byTitle.get("Club X vs Club Y"), "uecl");
  const leagueByTitle = new Map(rows.map(r => [r.Title, r.League]));
  assert.equal(leagueByTitle.get("Arsenal vs Chelsea"), "Premier League");
  assert.equal(leagueByTitle.get("Seoul vs Busan"), "K-league");
  assert.equal(FOOTBALL_OPTS.preferUpcoming, true, "PM 足球应先拉未来窗口，避免早盘被滚球分页挡住");
  assert.equal(FOOTBALL_OPTS.pastMs, 4 * 60 * 60 * 1000, "PM 足球补齐四小时内已开赛赛事，与当前列表窗口一致");
  assert.ok(FOOTBALL_OPTS.liveBudgetMs >= 10_000, "PM 足球冷拉预算应覆盖多页足球 tag 拉取");
  assert.equal(keysetUrls.length, 2, "先请求未来赛事，再补齐已开赛窗口");
  const firstUrl = new URL(keysetUrls[0]);
  const firstMin = Date.parse(firstUrl.searchParams.get("start_time_min") || "");
  assert.ok(firstMin >= now - 1_000, "首个 keyset 请求应从 now 开始拉未来赛事");
  const liveUrl = new URL(keysetUrls[1]);
  const liveMin = Date.parse(liveUrl.searchParams.get("start_time_min") || "");
  const liveMax = Date.parse(liveUrl.searchParams.get("start_time_max") || "");
  assert.ok(Math.abs(liveMin - (now - FOOTBALL_OPTS.pastMs)) < 1_000, "第二个请求从滚球窗口下界开始");
  assert.ok(Math.abs(liveMax - now) < 1_000, "滚球请求止于 now");
  console.log("football_gamma_fetch.smoke: ok", { n: rows.length, games: [...byTitle.values()] });
}
finally {
  restore();
}

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: vi.fn(), venues: vi.fn(), maps: vi.fn() }));
vi.mock("@changmen/db", async original => ({ ...await original(),
  fetchClientMatchesAll: mocks.rows,
  fetchPlatformMatchesForHiddenClientMatches: mocks.venues,
  loadTeamMapsForMatcher: mocks.maps,
}));
import { fetchMatcherHiddenClientMatches } from "./matcher_data.js";

const html = readFileSync(new URL("./public/index.html", import.meta.url), "utf8");
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1])
  .find(source => source.includes("function renderClientMatchCard("));
const definitions = script.slice(0, script.indexOf("document.getElementById('btn-match-merge-now')?.addEventListener"));
const from = Date.parse("2026-10-19T00:00:00+08:00");
const to = from + 86400000;
const match = { id: 42, title: "Alpha vs Beta", game_id: 1, start_time: from,
  home_gb_team_id: 11, away_gb_team_id: 22, reverse: ["OB"], matchs: { OB: "ob1", RAY: "ray1" } };
const platforms = { OB: [{ source_match_id: "ob1", home: "Beta", away: "Alpha", home_id: "b", away_id: "a", game: { code: "lol" } }] };
function context(values = {}) {
  const ctx = createContext({ window: {}, URLSearchParams, ...values });
  runInContext(definitions, ctx);
  return ctx;
}
function card(row, venueRows = platforms) {
  return runInContext("renderClientMatchCard(row, venueRows, {}, '', 'id')", context({ row, venueRows }));
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.venues.mockResolvedValue([]);
  mocks.maps.mockResolvedValue({});
});

it.each(["embedded", "heartbeat"])("shows the same composer for a %s status observation", processSource => {
  const state = { processRunning: true, processSource, matchCount: 3, processAgeMs: 30000 };
  const label = runInContext("matcherStatusLabel(state)", context({ state }));
  expect(label).toBe("composer 自动合场运行中 · 3 场 · 最近合场 30s前");
});

it.each([true, false])("keeps one manual compose request in flight and releases the button after success=%s", async ok => {
  const button = { textContent: "立即合场", disabled: false };
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const fetchJson = vi.fn(() => pending);
  const ctx = context({ document: { getElementById: () => button }, request: fetchJson });
  runInContext("fetchJson = request; load = refreshMatcherStatus = async () => {}; showActionToast = () => {};", ctx);
  const first = runInContext("runMatchMergeNow()", ctx);
  await runInContext("runMatchMergeNow()", ctx);
  expect(fetchJson).toHaveBeenCalledExactlyOnceWith("/api/match-merge", { method: "POST" });
  expect(button.disabled).toBe(true);
  complete({ res: { ok }, data: ok ? { ok: true } : { error: "合场失败" } });
  await first;
  expect(button).toEqual({ textContent: "立即合场", disabled: false });
});

it("uses the shared card and system orientation, with only restore available after ending", () => {
  const active = card(match);
  const ended = card({ ...match, ended_at: to });
  for (const output of [active, ended]) {
    expect(output).toContain('class="matched-header-layout"');
    expect(output).toContain("系统主");
    expect(output).toContain("系统客");
    expect(output).toContain('class="reverse-row"');
    const row = output.slice(output.indexOf('<tr class="reverse-row"'));
    expect(row.indexOf('class="team-name">Alpha')).toBeLessThan(row.indexOf('class="team-name">Beta'));
  }
  expect(active).toContain('data-end-cm="42"');
  expect(active).not.toContain('data-swap-gb-cm=');
  expect(active).toContain('data-reverse-toggle="1"');
  expect(ended).toContain('data-restore-cm="42"');
  expect(ended).toContain("标记结束");
  for (const marker of ["data-end-cm=", "data-swap-gb-cm=", "data-reverse-toggle=", "data-merge-cm-id=", 'class="team-link-handle', 'class="team-register-map-btn'])
    expect(ended).not.toContain(marker);
});

it("keeps ended cards visible when all venue sources or all associations are gone", () => {
  // 平台快照可能已变化，卡片仍服从已提交的当前结果，等待下一轮 matcher 更新。
  expect(card(match, {})).toContain('data-cm-id="42"');
  const ended = { ...match, ended_at: to };
  expect(card(ended, {})).toContain("已失效");
  const orphan = card({ ...ended, matchs: {} }, {});
  expect(orphan).toContain("Alpha");
  expect(orphan).toContain("Beta");
  expect(orphan).toContain("无平台关联");
  expect(orphan).toContain('data-restore-cm="42"');
});

it("keeps committed single-source and unknown-classification matches visible despite a newer empty platform snapshot", () => {
  const row = { ...match, matchs: { OB: "ob1" }, merge_mode: { mode: "unknown" } };
  const ctx = context({ row });
  expect(runInContext("filterDisplayClientMatches([row], {}).length", ctx)).toBe(1);
  expect(card(row, {})).toContain('data-cm-id="42"');
  const elements = new Map();
  ctx.elements = elements;
  runInContext("document = { getElementById: id => { if (!elements.has(id)) elements.set(id, {addEventListener(){},querySelectorAll(){return []}}); return elements.get(id); } }; renderMatchedListForMode([row], {}, {}, '', 'name', 'list', 'count', '')", ctx);
  expect(elements.get("list").innerHTML).toContain('data-cm-id="42"');
});

it("shows the same PM state in right-column recommendation and unmatched rows", () => {
  const pm = { platform: "Polymarket", source_match_id: "pm1", game: { code: "lol" }, start_time: from,
    home: "Alpha", away: "Beta", pm_sport: { updatedAt: from },
    pm_match_status: { kind: "live", label: "进行中 · 地图2/3" } };
  const rec = { matches: [pm], platforms: ["Polymarket"], game: { code: "lol" }, startTime: from, confidence: 0.9 };
  const body = {}, count = {};
  const ctx = context({ rec, pm, document: { getElementById: id => id === "unmatched-panels" ? body : count } });
  const recommended = runInContext("renderTeamRecCard(rec, [], 0, {})", ctx);
  runInContext("renderUnmatchedPlatforms({Polymarket:[pm]}, [], [], {}, '')", ctx);
  for (const output of [recommended, body.innerHTML]) {
    expect(output).toContain('class="pm-match-status live"');
    expect(output).toContain("PM · 进行中 · 地图2/3");
    expect(output).toContain("数据来源：PM");
  }
});

it("filters by start time before the 100-record limit, independent of the ending date", async () => {
  const rows = [
    { ...match, ended_at: to + 10 * 86400000, pm_sport: { status: "final" } },
    { ...match, id: 43, start_time: (to - 1) / 1000, ended_at: from - 86400000 },
    { ...match, id: 44, start_time: to, ended_at: to },
    { ...match, id: 45, start_time: from - 1, ended_at: to },
    { ...match, id: 46, ended_at: null },
    ...Array.from({ length: 110 }, (_, i) => ({ ...match, id: 100 + i, start_time: to, ended_at: to + (20 + i) * 86400000 })),
  ];
  const original = structuredClone(rows);
  mocks.rows.mockResolvedValue(rows);
  const result = await fetchMatcherHiddenClientMatches({ startFrom: String(from), startTo: String(to) });
  expect(result.hiddenClientMatches.map(row => row.id)).toEqual([42, 43]);
  expect(result.hiddenClientMatchFilteredCount).toBe(2);
  expect(result.hiddenClientMatchCount).toBe(114);
  expect(rows).toEqual(original);
  const all = await fetchMatcherHiddenClientMatches();
  expect(all.hiddenClientMatches).toHaveLength(100);
  expect(all.hiddenClientMatchFilteredCount).toBe(114);
});

it("rejects invalid date ranges and failed reads rather than reporting no records", async () => {
  for (const range of [{ startFrom: from }, { startFrom: from, startTo: from }, { startFrom: "bad", startTo: to }])
    await expect(fetchMatcherHiddenClientMatches(range)).rejects.toThrow("无效的开赛日期范围");
  expect(mocks.rows).not.toHaveBeenCalled();
  mocks.rows.mockResolvedValue(null);
  await expect(fetchMatcherHiddenClientMatches()).rejects.toThrow("已结束赛事读取失败");
});

it("keeps the latest selected date when requests complete in reverse order", async () => {
  const input = { value: "2026-10-19" }, body = {};
  const pending = [], rendered = [];
  const ctx = context({ document: { getElementById: id => id === "hidden-start-date" ? input : body },
    pending, rendered, fetch: undefined });
  runInContext("fetchJson = url => new Promise(resolve => pending.push({url, resolve})); renderHiddenPanel = rows => rendered.push(rows);", ctx);
  const first = runInContext("loadHiddenClientMatches()", ctx);
  input.value = "2026-10-20";
  const second = runInContext("loadHiddenClientMatches()", ctx);
  const query = new URL(pending[0].url, "http://localhost").searchParams;
  expect(Number(query.get("startFrom"))).toBe(new Date("2026-10-19T00:00:00").getTime());
  expect(Number(query.get("startTo"))).toBe(new Date("2026-10-20T00:00:00").getTime());
  pending[1].resolve({ data: { hiddenClientMatches: [{ id: 2 }] } });
  await second;
  pending[0].resolve({ data: { hiddenClientMatches: [{ id: 1 }] } });
  await first;
  expect(rendered).toEqual([[{ id: 2 }]]);
  expect(runInContext("_hiddenClientMatchesLoading", ctx)).toBe(false);
});

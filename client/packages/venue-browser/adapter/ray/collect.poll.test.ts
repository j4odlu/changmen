import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startRayCollector } from "./collect";

const mock = vi.hoisted(() => ({ get: vi.fn(), loadBets: vi.fn(), saveMatch: vi.fn(), saveBets: vi.fn(), notify: vi.fn(), calls: [] as string[] }));
vi.mock("./markets", () => ({ collectRayGet: mock.get, loadRayBets: mock.loadBets }));
vi.mock("./realtime", () => ({ createRayRealtimeClient: () => ({ start: async () => {}, stop: async () => {} }), getRayWsSourceMode: vi.fn(), cycleRayWsSourceMode: vi.fn(), rayWsSourceModeLabel: vi.fn() }));
vi.mock("@changmen/client-core/shared/wait", () => ({ wait: () => new Promise(() => {}) }));
vi.mock("../shared/webBridge", () => ({ useCollectStore: () => ({ saveMatch: mock.saveMatch, saveBets: mock.saveBets }) }));
vi.mock("../shared/collectNotify", () => ({ notifyCollectError: mock.notify }));

const now = Date.parse("2026-10-25T02:00:00Z");
const legacy = { id: 1, game_id: 70, start_time: "2026-10-25T02:00:00Z", round: 3,
  team: [{ pos: 1, team_id: 10, team_name: "原主队", team_short_name: "Original Home" }, { pos: 2, team_id: 20, team_name: "原客队" }] };
const basketball = { id: 100, game_id: 1072082, start_time: "2026-10-25T02:00:00Z", round: 4,
  team: [{ pos: 1, team_id: 1000, team_name: "太阳", team_short_name: "Phoenix Suns" }, { pos: 2, team_id: 2000, team_name: "勇士", team_short_name: "Golden State Warriors" }] };
const first = () => [legacy, ...Array.from({ length: 29 }, (_, i) => ({ id: i + 2, game_id: "unknown" }))];
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.clearAllMocks(); mock.calls.length = 0;
  vi.spyOn(Date, "now").mockReturnValue(now);
  mock.saveMatch.mockImplementation(async () => { mock.calls.push("matches"); return true; });
  mock.loadBets.mockImplementation(async (_platform, id) => { mock.calls.push(`odds:${id}`); return { bets: [] }; });
  mock.saveBets.mockResolvedValue(true);
});
afterEach(() => { stop?.(); vi.restoreAllMocks(); });

it("collects configured basketball through the unchanged first-page flow, names, BO and sequential odds order", async () => {
  mock.get.mockResolvedValueOnce({ code: 200, result: [legacy, basketball] });
  stop = startRayCollector();
  await vi.waitFor(() => expect(mock.saveBets).toHaveBeenCalledTimes(2));
  expect(mock.get.mock.calls.map(call => call[2])).toEqual(["match_type=2&page=1"]);
  expect(mock.saveMatch).toHaveBeenCalledTimes(1);
  expect(mock.saveMatch.mock.calls[0]![0]).toBe("RAY");
  const rows = mock.saveMatch.mock.calls[0]![1];
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ SourceMatchID: 1, SourceGameID: 70, BO: 3, Home: "原主队", Away: "原客队", HomeID: 10, AwayID: 20, StartTime: now });
  expect(rows[1]).toMatchObject({ SourceMatchID: 100, SourceGameID: 1072082, BO: 4, Home: "太阳", Away: "勇士", HomeID: 1000, AwayID: 2000, StartTime: now });
  expect(rows[1].Teams.map((team: { Name: string }) => team.Name)).toEqual(["太阳", "勇士"]);
  expect(mock.calls).toEqual(["matches", "odds:1", "odds:100"]);
});

it("keeps the original first-page scope even when the page is full", async () => {
  mock.get.mockResolvedValueOnce({ code: 200, result: first() });
  stop = startRayCollector();
  await vi.waitFor(() => expect(mock.saveBets).toHaveBeenCalledTimes(1));
  expect(mock.saveMatch).toHaveBeenCalledOnce();
  expect(mock.saveMatch.mock.calls[0]![1]).toMatchObject([{ SourceMatchID: 1, SourceGameID: 70, Home: "原主队", BO: 3 }]);
  expect(mock.calls).toEqual(["matches", "odds:1"]);
  expect(mock.get).toHaveBeenCalledOnce();
  expect(mock.get.mock.calls[0]![2]).toBe("match_type=2&page=1");
  expect(mock.notify).not.toHaveBeenCalled();
});

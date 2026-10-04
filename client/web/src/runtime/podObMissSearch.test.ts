import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchPodObMissFixture, resetPodObMissSearch, listPodObMissFixtures } from "./podObMissSearch";

const mock = vi.hoisted(() => ({ get: vi.fn(), fetch: vi.fn() }));
vi.mock("@/runtime/obSportFootballFetch", () => ({ getObSportPb: mock.get, fetchObFootballDtoByMid: mock.fetch }));
vi.mock("@/runtime/obSportSessionLocal", () => ({ readLocalSportObSession: () => ({ token: "test", uid: "1" }) }));
vi.mock("@/models/match", () => ({ toViewMatches: (rows: unknown[]) => rows }));
const kick = 1_800_000_000_000;
const alert = { eventId: "p1", home: "Stabaek II", away: "Haugesund II", starts: kick, league: "Norway - 3rd Division" };
const hit = { mid: "5726365", mhn: "Stabaek B", man: "FK Haugesund B", mgt: kick, tn: "Norway Division 3", csid: "1" };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(kick - 3600_000);
  mock.get.mockReset();
  mock.fetch.mockReset().mockResolvedValue(null);
  resetPodObMissSearch();
});
afterEach(() => { resetPodObMissSearch(); vi.useRealTimers(); });

describe("POD OB missing fixture recovery", () => {
  it("searches the away team when home search returns unrelated nonempty results", async () => {
    mock.get.mockResolvedValueOnce({ teamH5: [{ ...hit, mid: "5729630", mhn: "Molde (W)", man: "Stabaek (W)" }] })
      .mockResolvedValueOnce({ teamH5: [hit] });
    const pending = searchPodObMissFixture(alert);
    await vi.advanceTimersByTimeAsync(1600);
    const fixture = await pending;
    expect(mock.get.mock.calls.map(call => call[1].keyword)).toEqual(["Stabaek", "Haugesund"]);
    expect(fixture?.obMid).toBe("5726365");
    expect(listPodObMissFixtures()).toHaveLength(1);
  });

  it("retains English search names when hydration returns Chinese display names", async () => {
    mock.get.mockResolvedValue({ teamH5: [hit] });
    mock.fetch.mockResolvedValue({ id: 1, title: "斯塔贝克二队 vs 海于格松二队", game: "挪威丙级", startAt: kick,
      providers: { OB: "5726365" }, bets: [] });
    const fixture = await searchPodObMissFixture(alert);
    expect(fixture).toMatchObject({ homeEn: "Stabaek B", awayEn: "FK Haugesund B", gameEn: "Norway Division 3" });
  });

  it("deduplicates simultaneous alerts for the same fixture", async () => {
    mock.get.mockResolvedValue({ teamH5: [hit] });
    const result = await Promise.all([searchPodObMissFixture(alert), searchPodObMissFixture(alert)]);
    expect(mock.get).toHaveBeenCalledTimes(1);
    expect(result[0]?.obMid).toBe(result[1]?.obMid);
  });

  it("does not send queued searches after the alert has expired", async () => {
    const time = Date.now();
    mock.get.mockResolvedValue({ teamH5: [] });
    const pending = searchPodObMissFixture({ ...alert, alertedAt: time - 59_500 });
    await vi.advanceTimersByTimeAsync(1600);
    await pending;
    // 主队搜索立即执行，客队搜索等待节流时已过 60 秒，必须放弃。
    expect(mock.get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(mock.get).toHaveBeenCalledTimes(1);
  });

  it("stops retrying after four failed attempts even if reactive watchers request again", async () => {
    mock.get.mockResolvedValue({ teamH5: [] });
    const pending = searchPodObMissFixture(alert);
    await vi.advanceTimersByTimeAsync(1600);
    await pending;
    await vi.advanceTimersByTimeAsync(100_000);
    expect(mock.get).toHaveBeenCalledTimes(8);
    await searchPodObMissFixture(alert);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mock.get).toHaveBeenCalledTimes(8);
  });
});

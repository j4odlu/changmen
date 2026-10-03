import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchObFootballMatchMarkets } from "@/runtime/obSportFootballFetch";

const post = vi.hoisted(() => vi.fn());
vi.mock("@changmen/client-core/shared/a8Axios", () => ({
  a8Axios: { post },
  responseBodyText: String,
}));
vi.mock("@/runtime/obSportSessionLocal", () => ({
  readLocalSportObSession: () => ({ token: "trial-token", gateway: "https://sport.example" }),
}));

function response(plays: unknown[]) {
  return { status: 200, data: { code: "0000000", data: [{
    mid: "5505659", mhn: "Home", man: "Away", hps: plays,
  }] } };
}

const play = (hpid: string, hid: string, hv: string, odds = 1.9) => ({
  hpid, hl: [{ hid, hv, ol: [
    { oid: `${hid}-h`, ot: "1", ov: odds },
    { oid: `${hid}-a`, ot: "2", ov: odds },
  ] }],
});

beforeEach(() => post.mockReset());

describe("OB football market discovery", () => {
  it("keeps half-time and alternate lines from the list without fetching detail", async () => {
    post.mockResolvedValueOnce(response([
      play("4", "main", "-0.5"),
      play("4", "extra", "-1"),
      play("18", "half", "1.5"),
    ]));
    const rows = await fetchObFootballMatchMarkets("5505659");
    expect(rows.map(r => [r.MarketCode, r.Line])).toEqual([
      ["spreads", -0.5], ["spreads", -1], ["ht_totals", 1.5],
    ]);
    expect(rows[1]?.Selections?.map(s => s.OddID)).toEqual(["extra-h", "extra-a"]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[0]).toContain("structureMatchBaseInfoByMidsPB");
  });

  it("does not request detail just because some plays are absent or locked", async () => {
    post.mockResolvedValueOnce(response([play("2", "locked", "2.5", 0)]));
    const rows = await fetchObFootballMatchMarkets("5505659");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Selections?.every(s => s.Odds === 0)).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("falls back to detail once when the list has no market structure", async () => {
    post.mockResolvedValueOnce(response([]));
    post.mockResolvedValueOnce(response([play("19", "fallback", "0.5")]));
    const rows = await fetchObFootballMatchMarkets("5505659");
    expect(rows[0]?.MarketCode).toBe("ht_spreads");
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]?.[0]).toContain("getMatchBaseInfoByOddsPB");
    expect(post.mock.calls[1]?.[1]).not.toHaveProperty("hps");
  });

  it("keeps POD missing-line recovery even when other list markets exist", async () => {
    post.mockResolvedValueOnce(response([play("4", "main", "-0.5")]));
    post.mockResolvedValueOnce(response([
      play("4", "main", "-0.5"), play("4", "target", "-1"),
    ]));
    const rows = await fetchObFootballMatchMarkets("5505659", { includeDetail: true });
    expect(rows.map(r => r.Line)).toEqual([-0.5, -1]);
    expect(rows[1]?.Selections?.map(s => s.OddID)).toEqual(["target-h", "target-a"]);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("retains the available list if missing-line detail recovery fails", async () => {
    post.mockResolvedValueOnce(response([play("4", "main", "-0.5")]));
    post.mockRejectedValueOnce(new Error("detail unavailable"));
    const rows = await fetchObFootballMatchMarkets("5505659", { includeDetail: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Line).toBe(-0.5);
  });
});

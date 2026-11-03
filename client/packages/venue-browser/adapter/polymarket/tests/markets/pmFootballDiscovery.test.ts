import { afterEach, describe, expect, it } from "vitest";
import { clearPmFootballDirectCache, fetchPmFootballDirect } from "@changmen/venue-browser/polymarket/markets/pmFootballDiscovery";

afterEach(clearPmFootballDirectCache);

describe("pM football official discovery", () => {
  it.each([{ version: "v2" }, { version: "v3", positionIds: ["201", "202"] }, { positionIds: ["201", "202"] }])("excludes markets with ambiguous or missing selected assets: %j", metadata => {
    return expect(fetchPmFootballDirect({
      async get<T>() {
        return { events: [{ id: "invalid", title: "Arsenal vs Chelsea", startTime: new Date(Date.now() + 60_000).toISOString(),
          sport: { sport: "epl" }, markets: [{ ...metadata, sportsMarketType: "moneyline", outcomes: ["Arsenal", "Chelsea"],
            clobTokenIds: ["101", "102"], outcomePrices: [.5, .5] }],
        }], next_cursor: "" } as T;
      },
      async post<T>(): Promise<T> { throw new Error("invalid markets must not request prices"); },
    })).resolves.toEqual([]);
  });

  it("uses V2 positions for quote requests and published source IDs", async () => {
    const rows = await fetchPmFootballDirect({
      async get<T>() {
        return { events: [{ id: "v2-event", title: "Arsenal vs Chelsea", sport: { sport: "epl" },
          startTime: new Date(Date.now() + 60_000).toISOString(), markets: [{
            version: "v2", conditionId: "v2-cond", sportsMarketType: "moneyline",
            outcomes: ["Arsenal", "Chelsea"], clobTokenIds: ["101", "102"], positionIds: ["201", "202"],
          }],
        }], next_cursor: "" } as T;
      },
      async post<T>(_url: string, body: unknown) {
        expect(JSON.stringify(body)).toContain('"201"');
        expect(JSON.stringify(body)).not.toContain('"101"');
        return { 201: { SELL: .4 }, 202: { SELL: .2 } } as T;
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Bets[0]?.Sources.Polymarket).toMatchObject({ HomeOdds: 2.5, AwayOdds: 5 });
    expect(JSON.stringify(rows)).toContain("201");
    expect(JSON.stringify(rows)).not.toContain('"101"');
  });

  it("maps official Gamma moneyline and CLOB prices without VPS", async () => {
    const urls: string[] = [];
    const rows = await fetchPmFootballDirect({
      async get<T>(url: string) {
        urls.push(url);
        return {
          events: [{
            id: "evt-1",
            title: "South Korea vs Ecuador",
            startTime: new Date(Date.now() + 60_000).toISOString(),
            sport: { sport: "fif" },
            series: [{ title: "International Friendly" }],
            markets: [{
              conditionId: "cond-1",
              sportsMarketType: "moneyline",
              active: true,
              outcomes: JSON.stringify(["South Korea", "Ecuador"]),
              outcomePrices: JSON.stringify([0.5, 0.25]),
              clobTokenIds: JSON.stringify(["home-token", "away-token"]),
            }],
          }],
          next_cursor: "",
        } as T;
      },
      async post<T>() {
        return {
          "home-token": { SELL: 0.4 },
          "away-token": { SELL: 0.2 },
        } as T;
      },
    });

    expect(urls[0]).toContain("gamma-api.polymarket.com/events/keyset");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Matchs.Polymarket).toBe("evt-1");
    expect(rows[0]?.Bets[0]?.Sources.Polymarket?.HomeOdds).toBe(2.5);
    expect(rows[0]?.Bets[0]?.Sources.Polymarket?.AwayOdds).toBe(5);
  });

  it("keeps football events that started within the four-hour live window", async () => {
    const urls: string[] = [];
    const rows = await fetchPmFootballDirect({
      async get<T>(url: string) {
        urls.push(url);
        return {
          events: [{
            id: "live-1",
            title: "South Korea vs Ecuador",
            startTime: new Date(Date.now() - 60_000).toISOString(),
            sport: { sport: "fif" },
            markets: [{
              conditionId: "live-cond",
              sportsMarketType: "moneyline",
              outcomes: ["South Korea", "Ecuador"],
              outcomePrices: [0.5, 0.5],
              clobTokenIds: ["live-home", "live-away"],
            }],
          }],
          next_cursor: "",
        } as T;
      },
      async post<T>() { return {} as T; },
    });

    expect(new URL(urls[0]!).searchParams.get("start_time_min"))
      .toBeTruthy();
    expect(rows.map(row => row.Matchs.Polymarket)).toContain("live-1");
  });

  it("returns isolated cached rows so list composition cannot contaminate discovery", async () => {
    let gets = 0;
    const http = {
      async get<T>() {
        gets += 1;
        return {
          events: [{
            id: "evt-cache",
            title: "Arsenal vs Chelsea",
            startTime: new Date(Date.now() + 60_000).toISOString(),
            sport: { sport: "epl" },
            markets: [{
              conditionId: "cond-cache",
              sportsMarketType: "moneyline",
              outcomes: ["Arsenal", "Chelsea"],
              outcomePrices: [0.5, 0.5],
              clobTokenIds: ["cache-home", "cache-away"],
            }],
          }],
          next_cursor: "",
        } as T;
      },
      async post<T>() { return {} as T; },
    };
    const first = await fetchPmFootballDirect(http);
    first[0]!.Bets[0]!.Sources.OB = { Type: "OB" } as any;
    const second = await fetchPmFootballDirect(http);

    expect(gets).toBe(1);
    expect(second[0]!.Bets[0]!.Sources.OB).toBeUndefined();
  });
});

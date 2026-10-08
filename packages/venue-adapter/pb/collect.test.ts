import { beforeEach, describe, expect, test, vi } from "vitest";

const hasA8PluginRuntime = vi.hoisted(() => vi.fn());
const getCollectPlatform = vi.hoisted(() => vi.fn());
const getGames = vi.hoisted(() => vi.fn());
const resolvePbAccount = vi.hoisted(() => vi.fn());
const pbCollectEuroOdds = vi.hoisted(() => vi.fn());
const cleanVenueOdds = vi.hoisted(() => vi.fn());
const ingestAndReportPbParsedMatch = vi.hoisted(() => vi.fn());
const refreshOddsOnBets = vi.hoisted(() => vi.fn());
const saveMatch = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const saveBets = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const startPbWsStatusPoll = vi.hoisted(() => vi.fn(() => () => {}));

vi.mock("@changmen/client-core/chrome-plugin/bridge", () => ({
  hasA8PluginRuntime,
}));

vi.mock("@changmen/client-core/bridge/clientApi", () => ({
  getCollectPlatform,
  getGames,
}));

vi.mock("@changmen/client-core/bridge/oddsAccess", () => ({
  cleanVenueOdds,
}));

vi.mock("./transport", () => ({
  PB_PLUGIN_REQUIRED_MSG: "plugin required",
  pbCollectEuroOdds,
  resolvePbAccount,
}));

vi.mock("@changmen/client-core/shared/venueGames", () => ({
  getStaticVenueGames: () => ["cs2", "valorant", "league-of-legends", "dota-2", "king-of-glory"],
}));

vi.mock("./markets", () => ({
  ingestAndReportPbParsedMatch,
}));

vi.mock("./wsStatusPoll", () => ({
  startPbWsStatusPoll,
}));

vi.mock("@changmen/client-core/shared/wait", () => ({
  wait: vi.fn(() => new Promise(() => {})),
}));

vi.mock("../shared/collectNotify", () => ({
  notifyCollectError: vi.fn(),
}));

vi.mock("../shared/webBridge", () => ({
  useCollectStore: () => ({ saveMatch, saveBets }),
  useMatchStore: () => ({ refreshOddsOnBets }),
}));

const EURO_PAYLOAD = {
  leagues: [
    {
      id: 1,
      gameCode: "cs-go",
      gameName: "CS2",
      name: "Test League",
      events: [
        {
          id: 999001,
          rotNum: "10001",
          time: 1_700_000_000_000,
          live: true,
          participants: [
            { type: "HOME", name: "Team A", englishName: "Team A" },
            { type: "AWAY", name: "Team B", englishName: "Team B" },
          ],
          periods: {
            "0": {
              moneyLine: { homePrice: 1.91, awayPrice: 1.95, lineId: 42 },
            },
          },
        },
      ],
    },
  ],
};

describe("PB collect platform parity", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ingestAndReportPbParsedMatch.mockReset();
    pbCollectEuroOdds.mockReset();
    getGames.mockReset();
    getCollectPlatform.mockReset();
    resolvePbAccount.mockReset();
    hasA8PluginRuntime.mockReset();
    refreshOddsOnBets.mockReset();
    saveMatch.mockClear();
    saveBets.mockClear();
    saveMatch.mockResolvedValue(true);
    startPbWsStatusPoll.mockClear();
    const { setPbChangmenExtensions } = await import("./extensionsMode");
    setPbChangmenExtensions(true);
  });

  test("reads games before checking the PB account without requesting collect credentials", async () => {
    const { startPbCollector } = await import("./collect");
    hasA8PluginRuntime.mockReturnValue(true);
    getCollectPlatform.mockResolvedValue({ Gateway: "https://pb.example", BetName: "winner" });
    getGames.mockResolvedValue(["cs2"]);
    resolvePbAccount.mockReturnValue(null);

    const stop = startPbCollector();
    await vi.waitFor(() => expect(resolvePbAccount).toHaveBeenCalled());
    stop();

    expect(getCollectPlatform).not.toHaveBeenCalled();
    expect(getGames).toHaveBeenCalledWith("PB");
    expect(getGames.mock.invocationCallOrder[0]).toBeLessThan(
      resolvePbAccount.mock.invocationCallOrder[0]!,
    );
  });

  test("keeps cs-go euro/odds rows when Client_GetGames returns catalog cs2", async () => {
    const { startPbCollector } = await import("./collect");
    hasA8PluginRuntime.mockReturnValue(true);
    getCollectPlatform.mockResolvedValue({ Gateway: "https://pb.example", BetName: ".*" });
    getGames.mockResolvedValue(["cs2", "valorant", "league-of-legends", "dota-2", "king-of-glory"]);
    resolvePbAccount.mockReturnValue({
      provider: "PB",
      gateway: "https://pb.example",
      token: "{}",
      balance: 1,
    });
    pbCollectEuroOdds.mockResolvedValue(EURO_PAYLOAD);
    ingestAndReportPbParsedMatch.mockImplementation((row) => ({
      match: { SourceMatchID: row.matchId },
      bets: [],
    }));

    const stop = startPbCollector();
    await vi.waitFor(() => expect(ingestAndReportPbParsedMatch).toHaveBeenCalled());
    stop();

    expect(getGames).toHaveBeenCalledWith("PB");
    expect(pbCollectEuroOdds).toHaveBeenCalledWith(expect.anything(), true);
    expect(pbCollectEuroOdds).toHaveBeenCalledWith(expect.anything(), false);
    expect(getCollectPlatform).not.toHaveBeenCalled();
    expect(ingestAndReportPbParsedMatch.mock.calls[0]![0].gameId).toBe("cs-go");
    expect(ingestAndReportPbParsedMatch.mock.calls[0]![0].rotNum).toBe("10001");
  });

  test("falls back to static venue games when Client_GetGames returns empty", async () => {
    const { startPbCollector } = await import("./collect");
    hasA8PluginRuntime.mockReturnValue(true);
    getCollectPlatform.mockResolvedValue({ Gateway: "https://pb.example", BetName: ".*" });
    getGames.mockResolvedValue([]);
    resolvePbAccount.mockReturnValue({
      provider: "PB",
      gateway: "https://pb.example",
      token: "{}",
      balance: 1,
    });
    pbCollectEuroOdds.mockResolvedValue(EURO_PAYLOAD);
    ingestAndReportPbParsedMatch.mockImplementation((row) => ({
      match: { SourceMatchID: row.matchId },
      bets: [],
    }));

    const stop = startPbCollector();
    await vi.waitFor(() => expect(ingestAndReportPbParsedMatch).toHaveBeenCalled());
    stop();

    expect(ingestAndReportPbParsedMatch.mock.calls[0]![0].gameId).toBe("cs-go");
  });

  test("ingests live and prematch from separate 5s loops", async () => {
    const { startPbCollector } = await import("./collect");
    hasA8PluginRuntime.mockReturnValue(true);
    getCollectPlatform.mockResolvedValue({ Gateway: "https://pb.example", BetName: ".*" });
    getGames.mockResolvedValue(["cs2"]);
    resolvePbAccount.mockReturnValue({
      provider: "PB",
      gateway: "https://pb.example",
      token: "{}",
      balance: 1,
    });
    pbCollectEuroOdds.mockImplementation(async (_account, isLive: boolean) => {
      if (isLive) return EURO_PAYLOAD;
      return {
        leagues: [
          {
            id: 2,
            gameCode: "cs2",
            gameName: "CS2",
            name: "Prematch League",
            events: [
              {
                id: 999002,
                time: 1_700_000_100_000,
                live: false,
                participants: [
                  { type: "HOME", name: "Team C", englishName: "Team C" },
                  { type: "AWAY", name: "Team D", englishName: "Team D" },
                ],
                periods: {
                  "0": {
                    moneyLine: { homePrice: 1.8, awayPrice: 2.0, lineId: 99 },
                  },
                },
              },
            ],
          },
        ],
      };
    });
    ingestAndReportPbParsedMatch.mockImplementation((row) => ({
      match: { SourceMatchID: row.matchId },
      bets: [],
    }));

    const stop = startPbCollector();
    await vi.waitFor(() => expect(ingestAndReportPbParsedMatch).toHaveBeenCalledTimes(2));
    stop();

    const ids = ingestAndReportPbParsedMatch.mock.calls.map((c) => c[0].matchId).sort();
    expect(ids).toEqual(["999001", "999002"]);
    // changmen 扩展：两侧都写 fo
    expect(ingestAndReportPbParsedMatch.mock.calls.every((c) => c[2]?.writeFo === true)).toBe(true);
  });

  test("A8 default: only live loop, live writeFo true", async () => {
    const { setPbChangmenExtensions } = await import("./extensionsMode");
    setPbChangmenExtensions(false);
    try {
      const { startPbCollector } = await import("./collect");
      hasA8PluginRuntime.mockReturnValue(true);
      getCollectPlatform.mockResolvedValue({ Gateway: "https://pb.example", BetName: ".*" });
      getGames.mockResolvedValue(["cs2"]);
      resolvePbAccount.mockReturnValue({
        provider: "PB",
        gateway: "https://pb.example",
        token: "{}",
        balance: 1,
      });
      pbCollectEuroOdds.mockResolvedValue(EURO_PAYLOAD);
      ingestAndReportPbParsedMatch.mockImplementation((row) => ({
        match: { SourceMatchID: row.matchId },
        bets: [],
      }));

      const stop = startPbCollector();
      await vi.waitFor(() => expect(ingestAndReportPbParsedMatch).toHaveBeenCalled());
      stop();

      expect(pbCollectEuroOdds).toHaveBeenCalledWith(expect.anything(), true);
      expect(pbCollectEuroOdds).not.toHaveBeenCalledWith(expect.anything(), false);
      expect(ingestAndReportPbParsedMatch.mock.calls.every((c) => c[2]?.writeFo === true)).toBe(true);
      expect(startPbWsStatusPoll).not.toHaveBeenCalled();
    }
    finally {
      setPbChangmenExtensions(true);
    }
  });

  test("A8 default: SaveMatch after first live sync without 15s warmup", async () => {
    const { setPbChangmenExtensions } = await import("./extensionsMode");
    setPbChangmenExtensions(false);
    try {
      const { startPbCollector } = await import("./collect");
      hasA8PluginRuntime.mockReturnValue(true);
      getCollectPlatform.mockResolvedValue({ Gateway: "https://pb.example", BetName: ".*" });
      getGames.mockResolvedValue(["cs2"]);
      resolvePbAccount.mockReturnValue({
        provider: "PB",
        gateway: "https://pb.example",
        token: "{}",
        balance: 1,
      });
      pbCollectEuroOdds.mockResolvedValue(EURO_PAYLOAD);
      ingestAndReportPbParsedMatch.mockImplementation((row) => ({
        match: { SourceMatchID: row.matchId, Type: "PB" },
        bets: [{ BetID: `${row.matchId}:0` }],
      }));

      const stop = startPbCollector();
      await vi.waitFor(() => expect(saveMatch).toHaveBeenCalled());
      stop();

      expect(saveMatch).toHaveBeenCalledWith("PB", expect.arrayContaining([
        expect.objectContaining({ SourceMatchID: "999001" }),
      ]));
    }
    finally {
      setPbChangmenExtensions(true);
    }
  });

  test("pbLiveFoOnly legacy gate: prematch writeFo false when A8 mode", async () => {
    const { setPbChangmenExtensions } = await import("./extensionsMode");
    setPbChangmenExtensions(false);
    try {
      const { startPbCollector } = await import("./collect");
      hasA8PluginRuntime.mockReturnValue(true);
      getCollectPlatform.mockResolvedValue({ Gateway: "https://pb.example", BetName: ".*" });
      getGames.mockResolvedValue(["cs2"]);
      resolvePbAccount.mockReturnValue({
        provider: "PB",
        gateway: "https://pb.example",
        token: "{}",
        balance: 1,
      });
      pbCollectEuroOdds.mockImplementation(async (_account, isLive: boolean) => {
        if (isLive) return EURO_PAYLOAD;
        return {
          leagues: [
            {
              id: 2,
              gameCode: "cs2",
              gameName: "CS2",
              name: "Prematch League",
              events: [
                {
                  id: 999002,
                  time: 1_700_000_100_000,
                  live: false,
                  participants: [
                    { type: "HOME", name: "Team C", englishName: "Team C" },
                    { type: "AWAY", name: "Team D", englishName: "Team D" },
                  ],
                  periods: {
                    "0": {
                      moneyLine: { homePrice: 1.8, awayPrice: 2.0, lineId: 99 },
                    },
                  },
                },
              ],
            },
          ],
        };
      });
      ingestAndReportPbParsedMatch.mockImplementation((row) => ({
        match: { SourceMatchID: row.matchId },
        bets: [],
      }));

      const stop = startPbCollector();
      await vi.waitFor(() => expect(ingestAndReportPbParsedMatch).toHaveBeenCalled());
      stop();

      expect(pbCollectEuroOdds).not.toHaveBeenCalledWith(expect.anything(), false);
      expect(ingestAndReportPbParsedMatch.mock.calls.every((c) => c[2]?.writeFo === true)).toBe(true);
    }
    finally {
      setPbChangmenExtensions(true);
    }
  });

  test("changmen extensions: prematch writeFo true", async () => {
    const { setPbChangmenExtensions } = await import("./extensionsMode");
    setPbChangmenExtensions(true);
    try {
      const { startPbCollector } = await import("./collect");
      hasA8PluginRuntime.mockReturnValue(true);
      getCollectPlatform.mockResolvedValue({ Gateway: "https://pb.example", BetName: ".*" });
      getGames.mockResolvedValue(["cs2"]);
      resolvePbAccount.mockReturnValue({
        provider: "PB",
        gateway: "https://pb.example",
        token: "{}",
        balance: 1,
      });
      pbCollectEuroOdds.mockImplementation(async (_account, isLive: boolean) => {
        if (isLive) return EURO_PAYLOAD;
        return {
          leagues: [
            {
              id: 2,
              gameCode: "cs2",
              gameName: "CS2",
              name: "Prematch League",
              events: [
                {
                  id: 999002,
                  time: 1_700_000_100_000,
                  live: false,
                  participants: [
                    { type: "HOME", name: "Team C", englishName: "Team C" },
                    { type: "AWAY", name: "Team D", englishName: "Team D" },
                  ],
                  periods: {
                    "0": {
                      moneyLine: { homePrice: 1.8, awayPrice: 2.0, lineId: 99 },
                    },
                  },
                },
              ],
            },
          ],
        };
      });
      ingestAndReportPbParsedMatch.mockImplementation((row) => ({
        match: { SourceMatchID: row.matchId },
        bets: [],
      }));

      const stop = startPbCollector();
      await vi.waitFor(() => expect(ingestAndReportPbParsedMatch).toHaveBeenCalledTimes(2));
      stop();

      const byId = Object.fromEntries(
        ingestAndReportPbParsedMatch.mock.calls.map((c) => [c[0].matchId, c[2]]),
      );
      expect(byId["999001"]).toEqual({ writeFo: true });
      expect(byId["999002"]).toEqual({ writeFo: true });
      expect(startPbWsStatusPoll).toHaveBeenCalled();
    }
    finally {
      setPbChangmenExtensions(true);
    }
  });

  test("keeps prematch when live euro/odds throws", async () => {
    const { startPbCollector } = await import("./collect");
    hasA8PluginRuntime.mockReturnValue(true);
    getCollectPlatform.mockResolvedValue({ Gateway: "https://pb.example", BetName: ".*" });
    getGames.mockResolvedValue(["cs2"]);
    resolvePbAccount.mockReturnValue({
      provider: "PB",
      gateway: "https://pb.example",
      token: "{}",
      balance: 1,
    });
    pbCollectEuroOdds.mockImplementation(async (_account, isLive: boolean) => {
      if (isLive) throw new Error("live down");
      return EURO_PAYLOAD;
    });
    ingestAndReportPbParsedMatch.mockImplementation((row) => ({
      match: { SourceMatchID: row.matchId },
      bets: [],
    }));

    const stop = startPbCollector();
    await vi.waitFor(() => expect(ingestAndReportPbParsedMatch).toHaveBeenCalled());
    stop();

    expect(ingestAndReportPbParsedMatch.mock.calls[0]![0].matchId).toBe("999001");
  });

  test("live ingest completes while prematch euro/odds hangs", async () => {
    const { startPbCollector } = await import("./collect");
    hasA8PluginRuntime.mockReturnValue(true);
    getCollectPlatform.mockResolvedValue({ Gateway: "https://pb.example", BetName: ".*" });
    getGames.mockResolvedValue(["cs2"]);
    resolvePbAccount.mockReturnValue({
      provider: "PB",
      gateway: "https://pb.example",
      token: "{}",
      balance: 1,
    });
    pbCollectEuroOdds.mockImplementation(async (_account, isLive: boolean) => {
      if (!isLive) return new Promise(() => {});
      return EURO_PAYLOAD;
    });
    ingestAndReportPbParsedMatch.mockImplementation((row) => ({
      match: { SourceMatchID: row.matchId },
      bets: [],
    }));

    const stop = startPbCollector();
    await vi.waitFor(() => expect(ingestAndReportPbParsedMatch).toHaveBeenCalled());
    stop();

    expect(ingestAndReportPbParsedMatch.mock.calls.every((c) => c[0].matchId === "999001")).toBe(
      true,
    );
    expect(refreshOddsOnBets).toHaveBeenCalled();
    expect(pbCollectEuroOdds).toHaveBeenCalledWith(expect.anything(), true);
    expect(pbCollectEuroOdds).toHaveBeenCalledWith(expect.anything(), false);
  });
});

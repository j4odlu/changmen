import { describe, expect, test, vi } from "vitest";

const getCollectPlatform = vi.hoisted(() => vi.fn());
const resolveCollectSession = vi.hoisted(() => vi.fn());

vi.mock("@changmen/client-core/bridge/clientApi", () => ({
  getCollectPlatform,
}));

vi.mock("@changmen/client-core/shared/http", () => ({
  directPostJson: vi.fn(),
}));

vi.mock("../shared/collectSession", () => ({
  resolveCollectSession,
}));

vi.mock("@changmen/client-core/shared/wait", () => ({
  wait: vi.fn(() => new Promise(() => {})),
}));

vi.mock("@changmen/venue-browser/shared/collectNotify", () => ({
  notifyCollectError: vi.fn(),
}));

vi.mock("@changmen/venue-browser/shared/webBridge", () => ({
  useCollectStore: () => ({ saveMatch: vi.fn(), saveBets: vi.fn() }),
  useMatchStore: () => ({ refreshOddsOnBets: vi.fn() }),
}));

describe("IMT collect platform parity", () => {
  test("reads platform config before checking account session, matching A8 tJ", async () => {
    const { startImtCollector } = await import("./collect");
    getCollectPlatform.mockResolvedValue({ Gateway: "https://imt.example", BetName: "winner" });
    resolveCollectSession.mockResolvedValue(null);

    const stop = startImtCollector();
    await vi.waitFor(() => expect(resolveCollectSession).toHaveBeenCalled());
    stop();

    expect(getCollectPlatform).toHaveBeenCalledWith("IMT");
    expect(getCollectPlatform.mock.invocationCallOrder[0]).toBeLessThan(
      resolveCollectSession.mock.invocationCallOrder[0]!,
    );
  });
});

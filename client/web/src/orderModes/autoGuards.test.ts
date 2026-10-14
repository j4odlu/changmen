import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetMapBetMuteForTests, setFullMatchMuteGlobal, toggleMapMute } from "@/extensions/mapBetMute";
import { resetPrematchFullOnlyForTests, setPrematchFullMode } from "@/extensions/prematchFullOnly";
import { createDefaultUserConfig } from "@/types/userConfig";
import { executeArbBet } from "./router";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  user: { userId: "owner", extensionPrefs: { pmArbOrderMode: "FOK", pmGtcV1Activation: "1:owner" } },
}));
vi.mock("pinia", () => ({ getActivePinia: () => ({}) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => mocks.user }));
vi.mock("@/stores/betting/autoBet/phases/prepareArbAttempt", () => ({ prepareArbAttempt: mocks.prepare }));
vi.mock("@/stores/betting/autoBet/phases/checkArbLegs", () => ({ checkArbLegs: vi.fn() }));
vi.mock("@/stores/betting/autoBet/phases/placeArbLegs", () => ({ placeArbLegs: vi.fn() }));
vi.mock("@/stores/betting/autoBet/phases/finalizeArbBet", () => ({ finalizeArbBet: vi.fn() }));
vi.mock("@/stores/betting/activeBetRunSync", () => ({ syncActiveBetFail: vi.fn() }));
vi.mock("@/services/orderExecutionObservation", () => ({ beginExecutionObservation: vi.fn(), finishExecutionObservation: vi.fn() }));
vi.mock("@/stores/betting/autoBet/arbAttemptMetrics", () => ({ recordArbAttemptMetric: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  resetMapBetMuteForTests();
  resetPrematchFullOnlyForTests();
  mocks.prepare.mockResolvedValue(null);
});
afterEach(() => { resetMapBetMuteForTests(); resetPrematchFullOnlyForTests(); });

describe.each(["FOK", "GTC"])("%s automatic entry keeps real market guards", (mode) => {
  function run(round: number) {
    mocks.user.extensionPrefs.pmArbOrderMode = mode;
    return executeArbBet({
      match: { id: 1, liveRound: 0, startAt: Date.now() + 86_400_000 } as never,
      bet: { id: 2, round } as never,
      config: createDefaultUserConfig(),
      setMessage: vi.fn(),
    });
  }

  it("blocked and then unblocked full-match mute is respected through the router", async () => {
    setFullMatchMuteGlobal(true);
    await run(0);
    expect(mocks.prepare).not.toHaveBeenCalled();
    setFullMatchMuteGlobal(false);
    await run(0);
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });

  it("a muted map remains blocked", async () => {
    toggleMapMute(1, 1);
    await run(1);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it.each(["liveRound", "startAt"] as const)("%s filter rejects maps but still allows the prematch full market", async (criterion) => {
    setPrematchFullMode(criterion);
    await run(1);
    expect(mocks.prepare).not.toHaveBeenCalled();
    await run(0);
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });
});

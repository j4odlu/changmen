import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeArbBet } from "@/orderModes/router";
import { finishExecutionObservation } from "@/services/orderExecutionObservation";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), check: vi.fn(), place: vi.fn(), finalize: vi.fn(),
  user: { userId: "owner", extensionPrefs: { pmArbOrderMode: "FOK", pmGtcV1Activation: undefined as string | undefined } } }));
vi.mock("pinia", () => ({ getActivePinia: () => ({}) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => mocks.user }));
vi.mock("@/stores/betting/activeBetRunSync", () => ({ syncActiveBetFail: vi.fn() }));
vi.mock("@/extensions/mapBetMute", () => ({ isMapMuteActive: () => false }));
vi.mock("@/extensions/prematchFullOnly", () => ({ isPrematchFullMarketAllowed: () => true }));
vi.mock("@/services/orderExecutionObservation", () => ({ beginExecutionObservation: vi.fn(), finishExecutionObservation: vi.fn() }));
vi.mock("@/extensions/arbBet/singleLeg9999MapCount", () => ({ releaseSingleLeg9999MapFill: vi.fn(), releaseSingleLeg9999MapFillKeys: vi.fn() }));
vi.mock("@/stores/betting/autoBet/arbAttemptMetrics", () => ({ recordArbAttemptMetric: vi.fn() }));
vi.mock("@/stores/betting/autoBet/phases/prepareArbAttempt", () => ({ prepareArbAttempt: mocks.prepare }));
vi.mock("@/stores/betting/autoBet/phases/checkArbLegs", () => ({ checkArbLegs: mocks.check }));
vi.mock("@/stores/betting/autoBet/phases/placeArbLegs", () => ({ placeArbLegs: mocks.place }));
vi.mock("@/stores/betting/autoBet/phases/finalizeArbBet", () => ({ finalizeArbBet: mocks.finalize }));
const checked = { linkId: 3, betBothLegs: true, singleLegByRate: false, legA: { type: "Polymarket" }, legB: { type: "RAY" } };
const params = () => ({ match: { id: 1 }, bet: { id: 2 }, config: {}, setMessage: vi.fn() } as never);
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.extensionPrefs = { pmArbOrderMode: "FOK", pmGtcV1Activation: undefined };
  mocks.prepare.mockResolvedValue(checked); mocks.check.mockResolvedValue(checked);
  mocks.place.mockResolvedValue({ original: "placed" }); mocks.finalize.mockResolvedValue(undefined);
});
describe("PM mode selection uses one public arbitrage pipeline", () => {
  it.each(["FOK", "GTC", "invalid"])("%s without activation retains FOK preparation and all public phases", async (mode) => {
    mocks.user.extensionPrefs.pmArbOrderMode = mode; const input = params(); await executeArbBet(input);
    expect(mocks.prepare.mock.calls[0]![0]).toEqual(input);
    expect(mocks.place).toHaveBeenCalledOnce(); expect(mocks.finalize).toHaveBeenCalledOnce();
  });
  it("activation for another owner cannot select GTC", async () => {
    mocks.user.extensionPrefs = { pmArbOrderMode: "GTC", pmGtcV1Activation: "1:foreign" };
    await executeArbBet(params()); expect(mocks.prepare.mock.calls[0]![0].pmOrderMode).toBeUndefined();
  });
  it("activated GTC goes through the same prepare/check/place/finalize functions", async () => {
    mocks.user.extensionPrefs = { pmArbOrderMode: "GTC", pmGtcV1Activation: "1:owner" };
    await executeArbBet(params());
    for (const phase of [mocks.prepare, mocks.check, mocks.place, mocks.finalize]) {
      expect(phase).toHaveBeenCalledOnce(); expect(phase.mock.calls[0]![0].pmOrderMode).toBe("GTC");
    }
    expect(mocks.finalize.mock.calls[0]![1]).toEqual({ original: "placed" });
  });
  it.each(["FOK", "GTC"])("%s is frozen before preparation awaits", async (mode) => {
    mocks.user.extensionPrefs = { pmArbOrderMode: mode, pmGtcV1Activation: "1:owner" };
    mocks.prepare.mockImplementationOnce(async () => { mocks.user.extensionPrefs.pmArbOrderMode = mode === "GTC" ? "FOK" : "GTC"; return checked; });
    await executeArbBet(params()); expect(mocks.place.mock.calls[0]![0].pmOrderMode).toBe(mode === "GTC" ? "GTC" : undefined);
  });
  it("GTC failure closes original resources without a fallback or second place", async () => {
    mocks.user.extensionPrefs = { pmArbOrderMode: "GTC", pmGtcV1Activation: "1:owner" };
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.place.mockImplementationOnce(async attempt => { attempt.originalExecution = { close }; throw new Error("DB unavailable"); });
    await executeArbBet(params()); expect(close).toHaveBeenCalledOnce();
    expect(mocks.place).toHaveBeenCalledOnce(); expect(mocks.finalize).not.toHaveBeenCalled();
    expect(finishExecutionObservation).toHaveBeenCalledWith(undefined, 3, "exception", "place", "DB unavailable");
  });
  it("a no-PM combination still enters every public phase with the preference enabled", async () => {
    mocks.user.extensionPrefs = { pmArbOrderMode: "GTC", pmGtcV1Activation: "1:owner" };
    mocks.prepare.mockResolvedValueOnce({ ...checked, legA: { type: "OB" } });
    await executeArbBet(params()); expect(mocks.check).toHaveBeenCalledOnce(); expect(mocks.place).toHaveBeenCalledOnce(); expect(mocks.finalize).toHaveBeenCalledOnce();
  });
});

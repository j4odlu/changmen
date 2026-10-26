import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeArbBet } from "@/orderModes/router";
import { finishExecutionObservation } from "@/services/orderExecutionObservation";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), check: vi.fn(), place: vi.fn(), finalize: vi.fn(),
  user: { userId: "owner", extrasLoaded: true, extensionPrefs: { pmArbOrderMode: "FOK", pmGtcV1Activation: undefined as string | undefined } } }));
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
  vi.clearAllMocks(); mocks.user.extrasLoaded = true; mocks.user.extensionPrefs = { pmArbOrderMode: "FOK", pmGtcV1Activation: undefined };
  mocks.prepare.mockResolvedValue(checked); mocks.check.mockResolvedValue(checked);
  mocks.place.mockResolvedValue({ original: "placed" }); mocks.finalize.mockResolvedValue(undefined);
});


describe("automatic PM arbitrage always uses the existing FOK pipeline", () => {
  it.each(["FOK", "GTC", "invalid"])("ignores retired %s preferences while retaining all public phases", async mode => {
    mocks.user.extensionPrefs = { pmArbOrderMode: mode, pmGtcV1Activation: "1:owner" };
    const input = params(); await executeArbBet(input);
    for (const phase of [mocks.prepare, mocks.check, mocks.place, mocks.finalize]) {
      expect(phase).toHaveBeenCalledOnce(); expect(phase.mock.calls[0]![0]).toEqual(input);
    }
    expect(mocks.prepare.mock.calls[0]![0]).not.toHaveProperty("pmOrderMode");
    expect(mocks.prepare.mock.calls[0]![0]).not.toHaveProperty("pmArbitragePauseReason");
  });
  it("ordinary submission failure preserves observation cleanup without a fallback", async () => {
    mocks.place.mockRejectedValueOnce(new Error("venue unavailable")); await executeArbBet(params());
    expect(mocks.place).toHaveBeenCalledOnce(); expect(mocks.finalize).not.toHaveBeenCalled();
    expect(finishExecutionObservation).toHaveBeenCalledWith(undefined, 3, "exception", "place", "venue unavailable");
  });
});

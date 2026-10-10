import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeArbBet } from "@/orderModes/router";
import { finishExecutionObservation } from "@/services/orderExecutionObservation";
import { recordArbAttemptMetric } from "@/stores/betting/autoBet/arbAttemptMetrics";
import { syncActiveBetFail } from "@/stores/betting/activeBetRunSync";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), check: vi.fn(), place: vi.fn(), finalize: vi.fn(), gtc: vi.fn(), user: { userId: "owner", extensionPrefs: { pmArbOrderMode: "FOK", pmGtcV1Activation: undefined as string | undefined } } }));
vi.mock("pinia", () => ({ getActivePinia: () => ({}) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => mocks.user }));
vi.mock("@/stores/betting/activeBetRunSync", () => ({ syncActiveBetPhase: vi.fn(), syncActiveBetFail: vi.fn(), syncActiveBetLeg: vi.fn(), scheduleActiveBetRunRemoval: vi.fn() }));
vi.mock("@/extensions/mapBetMute", () => ({ isMapMuteActive: () => false }));
vi.mock("@/extensions/prematchFullOnly", () => ({ isPrematchFullMarketAllowed: () => true }));
vi.mock("@/services/orderExecutionObservation", () => ({ beginExecutionObservation: vi.fn(), finishExecutionObservation: vi.fn() }));
vi.mock("@/extensions/arbBet/singleLeg9999MapCount", () => ({ releaseSingleLeg9999MapFill: vi.fn(), releaseSingleLeg9999MapFillKeys: vi.fn() }));
vi.mock("@/stores/betting/autoBet/arbAttemptMetrics", () => ({ recordArbAttemptMetric: vi.fn() }));
vi.mock("@/stores/betting/autoBet/phases/prepareArbAttempt", () => ({ prepareArbAttempt: mocks.prepare }));
vi.mock("@/stores/betting/autoBet/phases/checkArbLegs", () => ({ checkArbLegs: mocks.check }));
vi.mock("./check", () => ({ checkArbLegs: mocks.check }));
vi.mock("./prepare", () => ({ prepareArbAttempt: mocks.prepare }));
vi.mock("@/stores/betting/autoBet/phases/placeArbLegs", () => ({ placeArbLegs: mocks.place }));
vi.mock("@/stores/betting/autoBet/phases/finalizeArbBet", () => ({ finalizeArbBet: mocks.finalize }));
vi.mock("./execute", () => ({ executeGtc: mocks.gtc }));
const checked = { linkId: 3, betBothLegs: true, singleLegByRate: false, legA: { type: "Polymarket" }, legB: { type: "RAY" } };
const params = () => ({ match: { id: 1 }, bet: { id: 2 }, config: {}, setMessage: vi.fn() } as never);
beforeEach(() => { vi.clearAllMocks(); mocks.user.extensionPrefs = { pmArbOrderMode: "FOK", pmGtcV1Activation: undefined }; mocks.prepare.mockResolvedValue(checked); mocks.check.mockResolvedValue(checked); mocks.place.mockResolvedValue({ original: "fok-result" }); mocks.finalize.mockResolvedValue(undefined); mocks.gtc.mockResolvedValue({ executionKind: "pm-gtc-v1", observationOutcome: "gtc_orchestration_completed", message: "人工处理", traceStatus: "partial", failed: false }); });
describe("fOK and GTC module dispatch isolation", () => {
  it.each(["FOK", "GTC", "invalid"])("%s without explicit V1 activation calls original place/finalize unchanged", async (mode) => {
    mocks.user.extensionPrefs.pmArbOrderMode = mode; await executeArbBet(params());
    expect(mocks.place).toHaveBeenCalledOnce(); expect(mocks.place.mock.calls[0]?.[1]).toBe(checked);
    expect(mocks.finalize.mock.calls[0]?.[1]).toEqual({ original: "fok-result" }); expect(mocks.gtc).not.toHaveBeenCalled();
  });
  it("activation for a different user cannot route to GTC", async () => {
    mocks.user.extensionPrefs = { pmArbOrderMode: "GTC", pmGtcV1Activation: "1:foreign" }; await executeArbBet(params()); expect(mocks.place).toHaveBeenCalledOnce(); expect(mocks.gtc).not.toHaveBeenCalled();
  });
  it("explicit FOK ignores an existing GTC activation and unavailable GTC executor", async () => {
    mocks.user.extensionPrefs = { pmArbOrderMode: "FOK", pmGtcV1Activation: "1:owner" };
    mocks.gtc.mockRejectedValueOnce(new Error("GTC unavailable"));
    const input = params();
    await executeArbBet(input);
    expect(mocks.prepare.mock.calls[0]?.[0]).toEqual(input);
    expect(mocks.place).toHaveBeenCalledOnce(); expect(mocks.finalize).toHaveBeenCalledOnce();
    expect(mocks.gtc).not.toHaveBeenCalled();
  });
  it("activated pair routes only to GTC; original retry/finalize cannot run", async () => {
    mocks.user.extensionPrefs = { pmArbOrderMode: "GTC", pmGtcV1Activation: "1:owner" }; await executeArbBet(params());
    expect(mocks.gtc).toHaveBeenCalledOnce(); expect(mocks.place).not.toHaveBeenCalled(); expect(mocks.finalize).not.toHaveBeenCalled();
  });
  it("failed GTC does not silently fall back to FOK", async () => {
    mocks.user.extensionPrefs = { pmArbOrderMode: "GTC", pmGtcV1Activation: "1:owner" }; mocks.gtc.mockRejectedValueOnce(new Error("DB unavailable")); await executeArbBet(params());
    expect(mocks.place).not.toHaveBeenCalled(); expect(mocks.finalize).not.toHaveBeenCalled();
  });
  it("mode is frozen before shared preparation awaits", async () => {
    mocks.prepare.mockImplementationOnce(async () => { mocks.user.extensionPrefs = { pmArbOrderMode: "GTC", pmGtcV1Activation: "1:owner" }; return checked; });
    await executeArbBet(params()); expect(mocks.place).toHaveBeenCalledOnce(); expect(mocks.gtc).not.toHaveBeenCalled();
  });
  it("selected GTC never switches to FOK for unsupported single-leg results", async () => {
    mocks.user.extensionPrefs = { pmArbOrderMode: "GTC", pmGtcV1Activation: "1:owner" }; mocks.prepare.mockResolvedValueOnce(null);
    await executeArbBet(params()); expect(mocks.place).not.toHaveBeenCalled(); expect(mocks.gtc).not.toHaveBeenCalled();
  });
  it("gTC selected before preparation remains GTC when preferences change to FOK", async () => {
    mocks.user.extensionPrefs = { pmArbOrderMode: "GTC", pmGtcV1Activation: "1:owner" };
    mocks.prepare.mockImplementationOnce(async () => { mocks.user.extensionPrefs = { pmArbOrderMode: "FOK", pmGtcV1Activation: undefined }; return checked; });
    await executeArbBet(params());
    expect(mocks.gtc).toHaveBeenCalledOnce(); expect(mocks.place).not.toHaveBeenCalled();
  });
  it("gTC execution failure is observed as place rather than shared precheck", async () => {
    mocks.user.extensionPrefs = { pmArbOrderMode: "GTC", pmGtcV1Activation: "1:owner" };
    mocks.gtc.mockRejectedValueOnce(new Error("DB unavailable"));
    await executeArbBet(params());
    expect(finishExecutionObservation).toHaveBeenCalledWith(undefined, 3, "exception", "place", "DB unavailable");
    expect(syncActiveBetFail).toHaveBeenCalledWith(2, "DB unavailable", "下单");
    expect(mocks.place).not.toHaveBeenCalled();
  });
  it("gTC completion records its execution time without invoking FOK finalize", async () => {
    mocks.user.extensionPrefs = { pmArbOrderMode: "GTC", pmGtcV1Activation: "1:owner" };
    await executeArbBet(params());
    expect(recordArbAttemptMetric).toHaveBeenCalledWith(expect.objectContaining({ stop: "complete", phaseMs: expect.objectContaining({ place: expect.any(Number) }) }));
    expect(mocks.finalize).not.toHaveBeenCalled();
  });
  it("a failed progress observer cannot interrupt GTC error metrics or hide the original failure", async () => {
    mocks.user.extensionPrefs = { pmArbOrderMode: "GTC", pmGtcV1Activation: "1:owner" };
    mocks.gtc.mockRejectedValueOnce(new Error("DB unavailable"));
    vi.mocked(syncActiveBetFail).mockImplementationOnce(() => { throw new Error("progress unavailable"); });
    await expect(executeArbBet(params())).resolves.toBeUndefined();
    expect(recordArbAttemptMetric).toHaveBeenCalledWith(expect.objectContaining({ stop: "error" }));
    expect(finishExecutionObservation).toHaveBeenCalledWith(undefined, 3, "exception", "place", "DB unavailable");
    expect(mocks.place).not.toHaveBeenCalled(); expect(mocks.finalize).not.toHaveBeenCalled();
  });
});

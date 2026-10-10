import type { BetOption } from "@changmen/client-core/models/betOption";
import type { ArbBetAttemptParams, ArbBetReady } from "@/stores/betting/autoBet/phases/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkArbLegs as checkGtc } from "./check";
import { checkArbLegs as checkFok } from "@/stores/betting/autoBet/phases/checkArbLegs";
const mocks = vi.hoisted(() => ({ check: vi.fn(), blocked: vi.fn(), results: vi.fn(), fail: vi.fn() }));
vi.mock("./gateway", () => ({ checkBetting: mocks.check }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ checkBetting: mocks.check }) }));
vi.mock("@/stores/loseOrderStore", () => ({ useLoseOrderStore: () => ({ orders: new Map() }) }));
vi.mock("@/stores/oddsStore", () => ({ useOddsStore: () => ({ getEntry: () => undefined }) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ extensionPrefs: { stakeScaleByProfit: { enabled: false } } }) }));
vi.mock("@changmen/venue-adapter/polymarket", () => ({ getPolymarketPmSportBlockReasonFromOption: () => null, recordPmExecutionMetric: vi.fn() }));
vi.mock("@/services/orderObservation", () => ({ createObservationContext: vi.fn(), observeOption: vi.fn() }));
vi.mock("@/services/orderExecutionObservation", () => ({ observeArbSubmissionBlocked: mocks.blocked }));
vi.mock("@/stores/betting/autoBet/arbProgressTrace", () => ({ setArbExecutionTraceMeta: vi.fn() }));
vi.mock("@/shared/arbProgressLegMeta", () => ({ buildArbProgressLegPair: () => [] }));
vi.mock("@/shared/a8Notify", () => ({ a8Tip: vi.fn() }));
vi.mock("@/stores/betting/activeBetRunSync", () => ({ syncActiveBetPrecheckResults: mocks.results, syncActiveBetFail: mocks.fail,
  syncActiveBetPhase: vi.fn(), scheduleActiveBetRunRemoval: vi.fn() }));
const input = () => ({ legA: { type: "RAY", data: null, odds: 1.42 }, legB: { type: "Polymarket", data: null, odds: 5 },
  accountA: { provider: "RAY" }, accountB: { provider: "Polymarket" }, linkId: 123, betBothLegs: true, stakeScale: 1 }) as ArbBetReady;
const params = (timeout: number) => ({ bet: { id: 10 }, config: { checkTimeout: timeout, waitTime: {} }, setMessage: vi.fn() }) as unknown as ArbBetAttemptParams;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers();
  mocks.check.mockImplementation(async (_account, option: BetOption) => { option.data = { quote: true }; return option; });
});
afterEach(() => vi.useRealTimers());
describe.each([["FOK", checkFok], ["GTC", checkGtc]] as const)("%s paired precheck total-time gate", (_name, check) => {
  it("both legs pass and enter submission when total time is within the limit", async () => {
    const pair = input();
    expect(await check(params(3000), pair)).toMatchObject({ legA: { data: { quote: true } }, legB: { data: { quote: true } } });
    expect(mocks.blocked).not.toHaveBeenCalled();
    expect(mocks.fail).not.toHaveBeenCalled();
  });
  it("retains both passed results but records why neither leg will submit when total time exceeds the limit", async () => {
    const at = Date.now(); const pair = input();
    mocks.check.mockImplementation(async (_account, option: BetOption) => {
      option.data = { quote: true }; vi.setSystemTime(at + 3100); return option;
    });
    expect(await check(params(3000), pair)).toBeNull();
    expect(mocks.results).toHaveBeenCalledWith(10, { hasA: true, hasB: true, okA: true, okB: true });
    expect(mocks.blocked).toHaveBeenCalledWith(expect.objectContaining({ legA: pair.legA, legB: pair.legB }),
      "precheck_timeout", "超时时间：3100ms，大于设定值：3000ms");
    expect(mocks.fail).toHaveBeenCalledWith(10, "超时时间：3100ms，大于设定值：3000ms");
  });
});

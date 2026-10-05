import type { AccountStoreContext } from "./context";
import type { PlatformAccount } from "@/models/platformAccount";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useOrderObservationStore } from "../orderObservationStore";
import { startOrderObservation } from "@/services/orderObservation";
import { checkBetting, placeBet } from "./betGateway";

const mocks = vi.hoisted(() => ({ betting: vi.fn(), check: vi.fn(), post: vi.fn(), user: { isLoggedIn: true, userId: "u1" }, notify: vi.fn(() => ({ close: vi.fn() })) }));
vi.mock("@/services/orderObservationTransport", () => ({ uploadObservationBatch: mocks.post }));
vi.mock("@/runtime/providers", () => ({ getProvider: () => ({ checkBet: mocks.check, betting: mocks.betting }) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => mocks.user }));
vi.mock("@/stores/messageStore", () => ({ useMessageStore: () => ({ delayMessage: () => {} }) }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => "session-1", isAuthSessionCurrent: () => true, isAuthTransitionPending: () => false, post: mocks.post, unwrap: (data: { info: unknown }) => data.info }));
vi.mock("element-plus", () => ({ ElNotification: mocks.notify }));
vi.mock("@/shared/a8Notify", () => ({ bettingNotifyAccountLine: () => "account", bettingDetailHtml: () => "detail", bettingLoadingMessageHtml: () => "loading", bettingResultMessageHtml: () => "result" }));
vi.mock("@/security/pmVault", () => ({ accountTokenHasPrivateKey: () => false, ensurePmVaultUnlocked: async () => false, ensurePmVaultForAccounts: async () => false, hasVault: async () => false, isVaultKeyProvider: () => false, mergeVaultKeysIntoAccounts: () => {}, normalizePmVaultUserId: () => "" }));
vi.mock("@/realtime/publishBetting", () => ({ publishBettingEvent: async () => {} }));
vi.mock("@/shared/orderSound", () => ({ playOrderSuccessSound: async () => {} }));
vi.mock("@/stores/account/pmOptimisticOrder", () => ({ persistPolymarketMatchedBuyOrder: vi.fn() }));
vi.mock("@/stores/account/pmRejectOrder", () => ({ persistPolymarketExecutionReject: vi.fn() }));
vi.mock("@/stores/betting/autoBet/arbLegSettle", () => ({ settleArbLegUntilTerminal: vi.fn() }));
vi.mock("@/domain/polymarket/attachDetectionQuote", () => ({ attachPolymarketDetectionQuote: () => {} }));
vi.mock("@/domain/predictfun/attachDetectionQuote", () => ({ attachPredictFunDetectionQuote: () => {} }));
vi.mock("@changmen/venue-adapter/adaptation", () => ({ resolveVenueStakeFromPlanCny: (_account: unknown, amount: number) => amount }));

describe("下注主链路与旁路故障隔离", () => {
  const account = { accountId: 1, provider: "OB", currency: "CNY", playerName: "p", platformId: 1, platformName: "OB" } as PlatformAccount;
  const store = { getPlatformName: () => "OB" } as unknown as AccountStoreContext;
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    mocks.post.mockReset();
    mocks.betting.mockReset();
    mocks.check.mockReset();
    mocks.user.userId = "u1";
    mocks.post.mockImplementation(async () => { throw new Error("observer offline"); });
    startOrderObservation();
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("makes exactly one adapter bet with unchanged inputs despite upload failures", async () => {
    const option = new BetOption("OB", "m", "b", "i", 100, "Home", 2);
    option.data = { quote: "prepared" };
    const expected = new BetResult("OB", true);
    mocks.betting.mockResolvedValue(expected);
    const result = await placeBet(store, account, option, 10, { linkId: 123, requirePreparedQuote: true });
    expect(result).toBe(expected);
    expect(result.success).toBe(true);
    expect(mocks.betting).toHaveBeenCalledTimes(1);
    expect(mocks.betting.mock.calls[0]![1].data).toEqual({ quote: "prepared" });
    expect(option.betMoney).toBe(100);
    expect(option.odds).toBe(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.post).toHaveBeenCalled();
    expect(mocks.betting).toHaveBeenCalledTimes(1);
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("preserves prepared-quote rejection and never submits when precheck failed", async () => {
    const option = new BetOption("OB", "m", "b", "i", 100, "Home", 2);
    option.checkError = "closed";
    const result = await placeBet(store, account, option, 10, { requirePreparedQuote: true });
    expect(result.success).toBe(false);
    expect(result.message).toBe("closed");
    expect(mocks.betting).not.toHaveBeenCalled();
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("still submits a prepared option when observation metadata cannot be attached", async () => {
    const option = new BetOption("OB", "m", "b", "i", 100, "Home", 2);
    option.data = { quote: "prepared" };
    Object.freeze(option);
    const expected = new BetResult("OB", true);
    mocks.betting.mockResolvedValue(expected);
    expect(await placeBet(store, account, option, 10, { linkId: 123, requirePreparedQuote: true })).toBe(expected);
    expect(mocks.betting).toHaveBeenCalledTimes(1);
    expect(expected.link).toBe(123);
  });

  it("keeps the adapter return object and carries the same attempt ID across a replacement option", async () => {
    const original = new BetOption("OB", "m", "b", "i", 100, "Home", 2);
    const replacement = new BetOption("OB", "m", "b", "i", 100, "Home", 2);
    replacement.data = { quote: "fresh" };
    mocks.check.mockResolvedValue(replacement);
    expect(await checkBetting(store, account, original)).toBe(replacement);
    expect(replacement.observation?.attemptId).toBe(original.observation?.attemptId);
    expect(mocks.check).toHaveBeenCalledTimes(1);
  });
  it("records the venue business code for a blocked RAY precheck without exposing credentials", async () => {
    const option = new BetOption("RAY", "m", "b", "i", 100, "Home", 1.65);
    option.diagnosticLinkId = 123;
    option.checkError = "RAY 盘口请求失败";
    option.response = { code: 401, desc: "token=SECRET" };
    mocks.check.mockResolvedValue(option);
    await checkBetting(store, account, option);
    const check = useOrderObservationStore().forLink("u1", 123).find(row => row.kind === "precheck_result");
    expect(check?.reasonCode).toBe("market_request_failed");
    expect(check?.responseCode).toBe("401");
    expect(JSON.stringify(check)).not.toContain("SECRET");
    expect(mocks.betting).not.toHaveBeenCalled();
  });
  it.each([
    ["Polymarket 盘口价高于检测价，整单取消\n- 最佳卖价 0.46 高于检测价 0.4444", "price_above_detection", "卖价 0.46，限价 0.4444"],
    ["", "no_market_data", "未获取到可用盘口数据"],
  ])("records a specific blocked-precheck reason without changing the adapter return: %s", async (message, reason, summary) => {
    const option = new BetOption("OB", "m", "b", "i", 100, "Home", 2);
    option.diagnosticLinkId = 123;
    option.checkError = message;
    option.data = null;
    mocks.check.mockResolvedValue(option);
    expect(await checkBetting(store, account, option)).toBe(option);
    const check = useOrderObservationStore().forLink("u1", 123).find(row => row.kind === "precheck_result");
    expect(check?.outcome).toBe("blocked");
    expect(check?.reasonCode).toBe(reason);
    expect(check?.safeSummary).toContain(summary);
    expect(mocks.betting).not.toHaveBeenCalled();
  });

});

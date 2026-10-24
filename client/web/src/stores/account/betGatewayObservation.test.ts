import type { AccountStoreContext } from "./context";
import type { PlatformAccount } from "@/models/platformAccount";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useOrderObservationStore } from "../orderObservationStore";
import { observationEventLabel } from "@changmen/shared/order_observation_view";
import { startOrderObservation } from "@/services/orderObservation";
import { checkBetting, placeBet } from "./betGateway";
import { checkBetting as checkGtcBetting, prepareOtherLeg } from "@/orderModes/gtc/gateway";
import * as observation from "@/services/orderObservation";

const mocks = vi.hoisted(() => ({ vaultProvider: vi.fn(), sharedCheck: vi.fn(), sharedPlace: vi.fn(), delay: vi.fn(), sound: vi.fn(), publish: vi.fn(), gtcCheck: vi.fn(), stake: vi.fn((_account: unknown, amount: number) => amount), betting: vi.fn(), check: vi.fn(), post: vi.fn(), user: { isLoggedIn: true, userId: "u1" }, notify: vi.fn(() => ({ close: vi.fn() })) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ checkBetting: mocks.sharedCheck, betting: mocks.sharedPlace }) }));
vi.mock("@changmen/venue-browser/polymarket/gtc/index", () => ({ checkGtcBuy: mocks.gtcCheck }));
vi.mock("@/services/orderObservationTransport", () => ({ uploadObservationBatch: mocks.post }));
vi.mock("@/runtime/providers", () => ({ getProvider: () => ({ checkBet: mocks.check, betting: mocks.betting }) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => mocks.user }));
vi.mock("@/stores/messageStore", () => ({ useMessageStore: () => ({ delayMessage: mocks.delay }) }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => "session-1", isAuthSessionCurrent: () => true, isAuthTransitionPending: () => false, post: mocks.post, unwrap: (data: { info: unknown }) => data.info }));
vi.mock("element-plus", () => ({ ElNotification: mocks.notify }));
vi.mock("@/shared/a8Notify", () => ({ bettingNotifyAccountLine: () => "account", bettingDetailHtml: () => "detail", bettingLoadingMessageHtml: () => "loading", bettingResultMessageHtml: () => "result" }));
vi.mock("@/security/pmVault", () => ({ accountTokenHasPrivateKey: () => false, ensurePmVaultUnlocked: async () => false, ensurePmVaultForAccounts: async () => false, hasVault: async () => false, isVaultKeyProvider: mocks.vaultProvider, mergeVaultKeysIntoAccounts: () => {}, normalizePmVaultUserId: () => "" }));
vi.mock("@/realtime/publishBetting", () => ({ publishBettingEvent: mocks.publish }));
vi.mock("@/shared/orderSound", () => ({ playOrderSuccessSound: mocks.sound }));
vi.mock("@/stores/account/pmOptimisticOrder", () => ({ persistPolymarketMatchedBuyOrder: vi.fn() }));
vi.mock("@/stores/account/pmRejectOrder", () => ({ persistPolymarketExecutionReject: vi.fn() }));
vi.mock("@/stores/betting/autoBet/arbLegSettle", () => ({ settleArbLegUntilTerminal: vi.fn() }));
vi.mock("@/services/polymarketQuotes", () => ({ attachPolymarketDetectionQuote: () => {} }));
vi.mock("@/services/predictFunQuotes", () => ({ attachPredictFunDetectionQuote: () => {} }));
vi.mock("@changmen/venue-browser/adapter/adaptation", () => ({ resolveVenueStakeFromPlanCny: mocks.stake }));

describe("下注主链路与旁路故障隔离", () => {
  const account = { accountId: 1, provider: "OB", currency: "CNY", playerName: "p", platformId: 1, platformName: "OB" } as PlatformAccount;
  const store = { getPlatformName: () => "OB" } as unknown as AccountStoreContext;
  beforeEach(() => {
    mocks.notify.mockClear();
    setActivePinia(createPinia());
    vi.useFakeTimers();
    mocks.post.mockReset();
    mocks.betting.mockReset();
    mocks.check.mockReset();
    mocks.gtcCheck.mockReset();
    mocks.vaultProvider.mockReset().mockReturnValue(false);
    mocks.sharedCheck.mockReset().mockImplementation((account, option, opts) => checkBetting(store, account, option, opts));
    mocks.sharedPlace.mockReset().mockImplementation((account, option, seconds, opts) => placeBet(store, account, option, seconds, opts));
    mocks.delay.mockReset();
    mocks.sound.mockReset().mockResolvedValue(undefined);
    mocks.publish.mockReset().mockResolvedValue(undefined);
    mocks.stake.mockReset().mockImplementation((_account: unknown, amount: number) => amount);
    mocks.user.userId = "u1";
    mocks.post.mockImplementation(async () => { throw new Error("observer offline"); });
    startOrderObservation();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); });
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
    expect(mocks.notify).toHaveBeenNthCalledWith(1, expect.objectContaining({ position: "top-right", customClass: "notification loading OB", duration: 10_000 }));
    expect(mocks.notify).toHaveBeenNthCalledWith(2, expect.objectContaining({ position: "top-right", customClass: "notification OB", type: "success", duration: 10_000 }));
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
  it("shows concrete odds and tolerance in the blocked precheck timeline", async () => {
    const option = new BetOption("RAY", "m", "b", "i", 100, "Home", 1.65);
    option.diagnosticLinkId = 123;
    mocks.check.mockImplementation(async (_account, checked) => {
      await vi.advanceTimersByTimeAsync(608);
      checked.checkError = "RAY 赔率下降：检测赔率 1.65，当前赔率 1.6，超过允许差值 0.01";
      return checked;
    });
    const rayAccount = { ...account, provider: "RAY" } as PlatformAccount;
    expect(await checkBetting(store, rayAccount, option)).toBe(option);
    const check = useOrderObservationStore().forLink("u1", 123).find(row => row.kind === "precheck_result");
    expect(check).toMatchObject({ outcome: "blocked", reasonCode: "odds_changed", durationMs: 608 });
    expect(observationEventLabel(check!)).toBe("预检结果 · 被拦截 · 原因：RAY 赔率下降：检测赔率 1.65，当前赔率 1.6，超过允许差值 0.01 · 608ms");
    expect((await placeBet(store, rayAccount, option, 10, { requirePreparedQuote: true })).success).toBe(false);
    expect(mocks.betting).not.toHaveBeenCalled();
  });
  it.each([false, true])("records contradictory precheck data as inconsistent when adapter throws=%s", async throws => {
    const option = new BetOption("OB", "m", "b", "i", 100, "Home", 2);
    option.diagnosticLinkId = 123;
    mocks.check.mockImplementation(async (_account, checked) => {
      checked.data = { quote: "prepared" };
      checked.checkError = "closed";
      if (throws) throw new Error("closed");
      return checked;
    });
    expect(await checkBetting(store, account, option)).toBe(option);
    const check = useOrderObservationStore().forLink("u1", 123).find(row => row.kind === "precheck_result");
    expect(check).toMatchObject({ outcome: "inconsistent", reasonCode: "precheck_inconsistent" });
    expect(check?.safeSummary).toContain("不能据此认定已拦截");
    expect(option.data).toEqual({ quote: "prepared" });
    expect(option.checkError).toBe("closed");
    expect(mocks.betting).not.toHaveBeenCalled();
  });
  it.each(["RAY", "OB"] as const)("%s keeps its own precheck exception serialization", async provider => {
    const option = new BetOption(provider, "m", "b", "i", 100, "Home", 2);
    mocks.check.mockRejectedValue(new TypeError("missing odds row"));
    expect(await checkBetting(store, { ...account, provider } as PlatformAccount, option)).toBe(option);
    expect(option.checkError).toBe(provider === "RAY" ? "{}" : "missing odds row");
    expect(option.data).toBeNull();
    expect(mocks.betting).not.toHaveBeenCalled();
  });
  it.each(["matched", "delayed"])("records PM %s submission without claiming detection has started before settle", async status => {
    const option = new BetOption("Polymarket", "m", "b", "i", 10, "Home", 2);
    option.data = { quote: "prepared" };
    option.deferPostAcceptSettlement = true;
    const expected = new BetResult("Polymarket", true, "", undefined, { status });
    expected.pending = status === "delayed";
    expected.orderId = "pm-1";
    mocks.betting.mockResolvedValue(expected);
    expect(await placeBet(store, { ...account, provider: "Polymarket" } as PlatformAccount, option, 10, { linkId: 123, requirePreparedQuote: true })).toBe(expected);
    const facts = useOrderObservationStore().forLink("u1", 123);
    expect(facts.find(row => row.kind === "submission_result")?.observedStatus).toBe(status);
    expect(facts.filter(row => row.reasonCode === "reject_detection_started")).toHaveLength(0);
    expect(mocks.betting).toHaveBeenCalledTimes(1);
  });
  it("carries the actual RAY submission failure description into the progress record", async () => {
    const option = new BetOption("RAY", "m", "b", "i", 100, "Home", 1.76);
    option.data = { quote: "prepared" };
    const response = { code: 500, desc: "投注操作失败，请稍后重试" };
    const expected = new BetResult("RAY", false, response.desc, option.data, response);
    mocks.betting.mockResolvedValue(expected);
    const result = await placeBet(store, { ...account, provider: "RAY" } as PlatformAccount, option, 10, { linkId: 123, requirePreparedQuote: true });
    expect(result).toBe(expected);
    const submission = useOrderObservationStore().forLink("u1", 123).find(row => row.kind === "submission_result");
    expect(submission?.outcome).toBe("adapter_failed");
    expect(submission?.responseCode).toBe("500");
    expect(submission?.safeSummary).toBe("RAY 场馆返回：投注操作失败，请稍后重试");
    expect(mocks.betting).toHaveBeenCalledTimes(1);
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

  it.each([false, true])("records automatic PM GTC depth rejection when adapter throws=%s", async throws => {
    const pm = { ...account, provider: "Polymarket" } as PlatformAccount;
    const option = new BetOption("Polymarket", "m", "b", "i", 10, "Home", 3.03);
    option.diagnosticLinkId = 123;
    const message = "GTC 自动套利限价内深度不足，未发送双腿";
    mocks.check.mockImplementation(async (_account, checked) => {
      checked.data = null;
      checked.checkError = message;
      if (throws) throw new Error(message);
      return checked;
    });
    expect(await checkBetting(store, pm, option)).toBe(option);
    const check = useOrderObservationStore().forLink("u1", 123).find(row => row.kind === "precheck_result");
    expect(check).toMatchObject({ outcome: "blocked", errorCategory: "liquidity", reasonCode: "insufficient_depth",
      safeSummary: "限价内可成交深度不足，未发送双腿" });
    expect(option.checkError).toBe(message);
    expect(option.data).toBeNull();
    expect(mocks.betting).not.toHaveBeenCalled();
  });

  it("PM repeating gateway check never converts the already converted venue amount again", async () => {
    const pm = { ...account, provider: "Polymarket", currency: "USDT" } as PlatformAccount;
    const option = new BetOption("Polymarket", "m", "b", "i", 67, "Home", 2);
    mocks.stake.mockImplementation((_account: unknown, amount: number) => amount / 6.7);
    mocks.check.mockImplementation(async (_account, opt) => opt);
    await checkBetting(store, pm, option, { skipAccountRate: true });
    expect(option.betMoney).toBe(10); expect(option.planBetMoney).toBe(67);
    await checkBetting(store, pm, option, { skipAccountRate: true });
    expect(option.betMoney).toBe(10);
    expect(mocks.stake.mock.calls.map(c => c[1])).toEqual([67, 67]);
    expect(mocks.check.mock.calls[0][2].role).toBe("execute");
  });

  it("only explicit precheckOnly changes the PM role; manual 9999 remains execute", async () => {
    const pm = { ...account, provider: "Polymarket", rateConfig: [{ minOdds: 0, maxOdds: 0, rate: 9999 }] } as PlatformAccount;
    mocks.check.mockImplementation(async (_account, opt) => opt);
    await checkBetting(store, pm, new BetOption("Polymarket", "m", "b", "i", 67, "Home", 2), { role: "precheckOnly" });
    await checkBetting(store, pm, new BetOption("Polymarket", "m", "b", "i", 67, "Home", 2), { skipAccountRate: true });
    expect(mocks.check.mock.calls.map(c => c[2].role)).toEqual(["precheckOnly", "execute"]);
  });


  it("shared precheck selects GTC only for the frozen PM leg and converts stake once", async () => {
    const option = new BetOption("Polymarket", "m", "b", "i", 100, "Home", 2);
    const pm = { ...account, provider: "Polymarket" } as PlatformAccount;
    mocks.gtcCheck.mockImplementation(async (_account, checked) => { checked.data = { orderType: "GTC" }; return checked; });
    expect(await checkBetting(store, pm, option, { pmOrderMode: "GTC" })).toBe(option);
    expect(mocks.gtcCheck).toHaveBeenCalledExactlyOnceWith(pm, option, undefined, true);
    expect(mocks.check).not.toHaveBeenCalled(); expect(mocks.stake).toHaveBeenCalledOnce();
    const ray = new BetOption("RAY", "m", "b", "i", 100, "Away", 2);
    mocks.check.mockResolvedValue(ray);
    await checkBetting(store, { ...account, provider: "RAY" } as PlatformAccount, ray, { pmOrderMode: "GTC" });
    expect(mocks.check).toHaveBeenCalledOnce(); expect(mocks.gtcCheck).toHaveBeenCalledOnce();
  });

  it("manual GTC uses common stake conversion once and allows its resting-order precheck", async () => {
    const pm = { ...account, provider: "Polymarket", currency: "USDT" } as PlatformAccount;
    const option = new BetOption("Polymarket", "m", "b", "i", 67, "Home", 2);
    mocks.stake.mockReturnValue(10);
    mocks.gtcCheck.mockImplementation(async (_account, checked) => { checked.data = { orderType: "GTC" }; return checked; });
    expect(await checkGtcBetting(pm, option, { manual: true, skipAccountRate: true })).toBe(option);
    expect(mocks.stake).toHaveBeenCalledExactlyOnceWith(pm, 67, 2, expect.objectContaining({ skipAccountRate: true }));
    expect(option.betMoney).toBe(10); expect(option.planBetMoney).toBe(67);
    expect(mocks.gtcCheck).toHaveBeenCalledExactlyOnceWith(pm, option, undefined, false);
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("the GTC resting flag cannot change FOK or traditional venue prechecks", async () => {
    const pm = { ...account, provider: "Polymarket" } as PlatformAccount;
    mocks.check.mockImplementation(async (_account, option) => option);
    await checkBetting(store, pm, new BetOption("Polymarket", "m", "b", "i", 100, "Home", 2), { pmOrderMode: "FOK", pmGtcAllowResting: true });
    await checkGtcBetting(account, new BetOption("OB", "m", "b", "i", 100, "Home", 2), { manual: true });
    expect(mocks.check).toHaveBeenCalledTimes(2); expect(mocks.gtcCheck).not.toHaveBeenCalled();
  });

  it.each([false, true])("ordinary/GTC counterpart=%s keeps the real receipt when observation and log fail", async (gtc) => {
    const option = new BetOption("OB", "m", "b", "i", 100, "Home", 2);
    option.data = { quote: "prepared" };
    const expected = new BetResult("OB", true); expected.orderId = "original";
    vi.spyOn(expected, "saveLog").mockImplementation(() => { throw new Error("log offline"); });
    vi.spyOn(observation, "observeOption").mockImplementation(() => { throw new Error("observer offline"); });
    mocks.delay.mockImplementation(() => { throw new Error("stats offline"); });
    mocks.betting.mockResolvedValue(expected);
    const result = gtc ? await prepareOtherLeg(account, option, 123, 30)()
      : await placeBet(store, account, option, 30, { linkId: 123, requirePreparedQuote: true });
    expect(result).toBe(expected); expect(result.success).toBe(true); expect(result.link).toBe(123);
    expect(mocks.betting).toHaveBeenCalledExactlyOnceWith(account, option);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(option);
    expect(mocks.sound).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({ type: "success", duration: 30_000 }));
  });

  it.each(["throw", "reject"])("sound and publishing %s cannot discard a successful original", async (fault) => {
    const option = new BetOption("OB", "m", "b", "i", 100, "Home", 2); option.data = {};
    const result = new BetResult("OB", true); mocks.betting.mockResolvedValue(result);
    for (const effect of [mocks.sound, mocks.publish]) {
      if (fault === "throw") effect.mockImplementation(() => { throw new Error("effect offline"); });
      else effect.mockRejectedValue(new Error("effect offline"));
    }
    expect(await prepareOtherLeg(account, option, 123)()).toBe(result);
    expect(mocks.betting).toHaveBeenCalledOnce();
    await Promise.resolve();
  });

  it("an accepted pending GTC counterpart does not start a second confirmation or publish a fill", async () => {
    const ray = { ...account, provider: "RAY" } as PlatformAccount;
    const option = new BetOption("RAY", "m", "b", "i", 100, "Away", 2); option.data = {};
    const expected = new BetResult("RAY", true); expected.pending = true; expected.orderId = "pending-original";
    mocks.betting.mockResolvedValue(expected);
    const result = await prepareOtherLeg(ray, option, 123)();
    expect(result).toBe(expected); expect(result.pending).toBe(true);
    expect(option.deferPostAcceptSettlement).toBe(true);
    expect(mocks.betting).toHaveBeenCalledOnce(); expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.sound).not.toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenLastCalledWith(expect.objectContaining({ type: "warning" }));
  });

  it.each([false, true])("prepared ordinary/GTC=%s sends directly without restarting wallet preparation", async (gtc) => {
    const option = new BetOption("OB", "m", "b", "i", 100, "Home", 2);
    mocks.check.mockImplementation(async (_account, checked) => { checked.data = { frozen: true }; return checked; });
    await checkBetting(store, account, option);
    expect(mocks.vaultProvider).toHaveBeenCalledOnce();
    mocks.vaultProvider.mockImplementation(() => { throw new Error("late wallet preparation"); });
    const receipt = new BetResult("OB", true); receipt.orderId = "prepared-original";
    mocks.betting.mockResolvedValue(receipt);
    const result = gtc ? await prepareOtherLeg(account, option, 123)()
      : await placeBet(store, account, option, 10, { linkId: 123, requirePreparedQuote: true });
    expect(result).toBe(receipt);
    expect(mocks.vaultProvider).toHaveBeenCalledOnce();
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.betting).toHaveBeenCalledExactlyOnceWith(account, option);
  });

  it("a precheck log failure preserves the successful quote for the original send", async () => {
    const option = new BetOption("OB", "m", "b", "i", 100, "Home", 2);
    vi.spyOn(option, "saveLog").mockImplementation(() => { throw new Error("log unavailable"); });
    mocks.check.mockImplementation(async (_account, checked) => { checked.data = { frozen: true }; return checked; });
    expect(await checkBetting(store, account, option)).toBe(option);
    const receipt = new BetResult("OB", true); mocks.betting.mockResolvedValue(receipt);
    expect(await prepareOtherLeg(account, option, 123)()).toBe(receipt);
    expect(mocks.betting).toHaveBeenCalledOnce();
  });

  it("logs the adapter's returned precheck object without logging the outdated input", async () => {
    const input = new BetOption("OB", "m", "b", "i", 100, "Home", 2);
    const checked = new BetOption("OB", "m", "b", "i", 100, "Home", 2); checked.data = { frozen: true };
    const oldLog = vi.spyOn(input, "saveLog"); const newLog = vi.spyOn(checked, "saveLog");
    mocks.check.mockResolvedValue(checked);
    expect(await checkBetting(store, account, input)).toBe(checked);
    expect(newLog).toHaveBeenCalledExactlyOnceWith(account);
    expect(oldLog).not.toHaveBeenCalled();
  });

  it.each([false, true])("broken display data cannot stop a prepared ordinary/GTC=%s POST", async (gtc) => {
    const option = new BetOption("OB", "m", "b", "i", 100, "Home", 2); option.data = { frozen: true };
    Object.defineProperty(option, "match", { get: () => { throw new Error("display unavailable"); } });
    const receipt = new BetResult("OB", true); receipt.orderId = "original"; mocks.betting.mockResolvedValue(receipt);
    const result = gtc ? await prepareOtherLeg(account, option, 123)()
      : await placeBet(store, account, option, 10, { linkId: 123, requirePreparedQuote: true });
    expect(result).toBe(receipt);
    expect(mocks.betting).toHaveBeenCalledOnce();
    expect(mocks.betting.mock.calls[0]![0]).toBe(account);
    expect(mocks.betting.mock.calls[0]![1]).toBe(option);
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("manual ordinary fallback still prepares and prechecks once before one adapter call", async () => {
    const option = new BetOption("OB", "m", "b", "i", 100, "Home", 2);
    mocks.check.mockImplementation(async (_account, checked) => { checked.data = { frozen: true }; return checked; });
    const receipt = new BetResult("OB", true); mocks.betting.mockResolvedValue(receipt);
    expect(await placeBet(store, account, option)).toBe(receipt);
    expect(mocks.vaultProvider).toHaveBeenCalled();
    expect(mocks.check).toHaveBeenCalledOnce();
    expect(mocks.betting).toHaveBeenCalledExactlyOnceWith(account, option);
  });

  it("auxiliary failures also preserve a real rejected receipt without retrying it", async () => {
    const option = new BetOption("OB", "m", "b", "i", 100, "Home", 2); option.data = { frozen: true };
    const receipt = new BetResult("OB", false, "venue rejected"); receipt.orderId = "rejected-original";
    vi.spyOn(receipt, "saveLog").mockImplementation(() => { throw new Error("log unavailable"); });
    mocks.delay.mockImplementation(() => { throw new Error("stats unavailable"); });
    mocks.betting.mockResolvedValue(receipt);
    expect(await prepareOtherLeg(account, option, 123)()).toBe(receipt);
    expect(receipt.orderId).toBe("rejected-original");
    expect(receipt.success).toBe(false);
    expect(mocks.betting).toHaveBeenCalledOnce();
    expect(mocks.sound).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

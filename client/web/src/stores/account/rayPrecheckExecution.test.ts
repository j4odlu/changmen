import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {BetOption} from "@changmen/client-core/models/betOption";
import {PlatformAccount} from "@/models/platformAccount";
import {clearOddsAccess, registerOddsAccess} from "@changmen/client-core/bridge/oddsAccess";
import {rayProvider} from "@changmen/venue-browser/adapter/ray/bet";
import {checkBetting, placeBet} from "./betGateway";
import type {AccountStoreContext} from "./context";

const mocks = vi.hoisted(() => ({request: vi.fn(), observe: vi.fn(), notify: vi.fn(() => ({close: vi.fn()}))}));
vi.mock("@changmen/client-core/shared/a8Axios", () => ({a8Axios: {request: mocks.request},
  responseBodyText: (value: unknown) => typeof value === "string" ? value : JSON.stringify(value)}));
vi.mock("@/runtime/providers", () => ({getProvider: () => rayProvider}));
vi.mock("@/services/orderObservation", () => ({createObservationContext: () => ({attemptId: "ray-audit-attempt"}), observeOption: mocks.observe}));
vi.mock("@/security/pmVault", () => ({isVaultKeyProvider: () => false}));
vi.mock("@/security/pmVault/retainedPmSession", () => ({getRetainedPmPrivateKey: () => undefined}));
vi.mock("@/stores/userStore", () => ({useUserStore: () => ({userId: "audit", isLoggedIn: true})}));
vi.mock("@/stores/messageStore", () => ({useMessageStore: () => ({delayMessage: () => {}, limitMessage: () => "limit"})}));
vi.mock("element-plus", () => ({ElNotification: mocks.notify}));
vi.mock("@/shared/a8Notify", () => ({bettingNotifyAccountLine: () => "account", bettingDetailHtml: () => "detail",
  bettingLoadingMessageHtml: () => "loading", bettingResultMessageHtml: () => "result"}));
vi.mock("@/api/client", () => ({getAuthSessionVersion: () => "session", isAuthSessionCurrent: () => true}));
vi.mock("@/realtime/publishBetting", () => ({publishBettingEvent: async () => {}}));
vi.mock("@/shared/orderSound", () => ({playOrderSuccessSound: async () => {}}));
vi.mock("@/stores/account/pmOptimisticOrder", () => ({persistPolymarketMatchedBuyOrder: vi.fn()}));
vi.mock("@/stores/account/pmRejectOrder", () => ({persistPolymarketExecutionReject: vi.fn()}));
vi.mock("@/stores/betting/autoBet/arbLegSettle", () => ({settleArbLegUntilTerminal: vi.fn()}));

describe("RAY actual account gateway and quote invalidation", () => {
  const cache = new Map<string, number>();
  const account = new PlatformAccount({provider: "RAY", accountId: 1, gateway: "https://ray.example", token: "Bearer test",
    currency: "CNY", rateConfig: [{minOdds: 0, maxOdds: 0, rate: 2}]});
  const store = {getPlatformName: () => "RAY"} as unknown as AccountStoreContext;
  beforeEach(() => {
    mocks.request.mockReset(); mocks.observe.mockClear(); mocks.notify.mockClear(); cache.clear();
    registerOddsAccess({read: (_p, id, fallback) => cache.get(id) ?? fallback, save: (_p, entry) => {cache.set(entry.id, entry.odds);},
      clean: () => {}, isOdds: (_p, id) => cache.has(id), getEntry: () => undefined, updateOddsLock: () => {},
      updateBetLock: () => {}, updateMessage: () => {}, getLimit: () => undefined, setLimit: () => {}});
  });
  afterEach(clearOddsAccess);

  it.each([null, {code: 200, result: null, etag: "same-empty-market"}, {code: 200, result: {odds: []}}])(
    "clears a stale prepared order and cached quote without a POST when the real gateway receives %j", async response => {
      const option = new BetOption("RAY", "400", "200", "100", 100, "Home", 1.89);
      option.data = {previousPrepared: true}; cache.set("100", 2);
      mocks.request.mockResolvedValue({status: 200, headers: {}, data: JSON.stringify(response)});
      expect(await checkBetting(store, account, option)).toBe(option);
      expect(option.data).toBeNull(); expect(option.checkError).toContain("RAY 无盘口数据"); expect(cache.get("100")).toBe(0);
      expect(mocks.observe).toHaveBeenCalledWith(option, account, "precheck_result", expect.objectContaining({
        outcome: "blocked", errorCategory: "market_data", reasonCode: "no_market_data",
      }));
      const result = await placeBet(store, account, option, 0, {requirePreparedQuote: true});
      expect(result.success).toBe(false);
      expect(mocks.request).toHaveBeenCalledTimes(1);
      expect(mocks.request.mock.calls[0]![0].method).toBe("GET");
    });

  it("resolves account stake once and submits the unchanged A8 prepared JSON without another precheck", async () => {
    const option = new BetOption("RAY", "400", "200", "100", 100, "Home", 1.89);
    mocks.request.mockResolvedValueOnce({status: 200, headers: {}, data: JSON.stringify({code: 200, result: {
      start_time: "2099-01-01", odds: [{odds_id: "100", enable_parlay: 1, status: 1, odds: 1.88, bet_limit: [10, 3000]}],
    }})});
    await checkBetting(store, account, option);
    expect(option.betMoney).toBe(200);
    const prepared = JSON.stringify(option.data);
    expect(option.data).toMatchObject({total_stake: "200", total_bet_bonus: "376.00"});
    mocks.request.mockResolvedValueOnce({status: 200, headers: {}, data: JSON.stringify({code: 200, result: 900})});
    const result = await placeBet(store, account, option, 0, {requirePreparedQuote: true});
    expect(result.success).toBe(true); expect(option.betMoney).toBe(200);
    expect(mocks.request.mock.calls.map(call => call[0].method)).toEqual(["GET", "POST"]);
    expect(new URLSearchParams(mocks.request.mock.calls[1]![0].data).get("order")).toBe(prepared);
  });
});

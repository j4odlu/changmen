import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PlatformAccount } from "@/models/platformAccount";
import type { AccountStoreContext } from "./context";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";

const m = vi.hoisted(() => ({ session: "one", publisher: true, post: vi.fn(), betting: vi.fn(), getOrders: vi.fn(),
  settle: vi.fn(), outcome: "filled", publish: vi.fn(), sent: vi.fn(), mark: vi.fn() }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => m.session, isAuthSessionCurrent: (v: string) => v === m.session,
  post: m.post, unwrap: (value: { success: number; info?: unknown }) => { if (value.success !== 1) throw new Error("save failed"); return value.info; } }));
vi.mock("@changmen/venue-browser/adapter/polymarket", () => ({ pmSubmitScope: () => "owner-wallet", pmAccountSubmitAttempts: () => [],
  pmSubmitMaker: () => "0x1111111111111111111111111111111111111111", hasOpenPolymarketPosition: () => true, resolvePmRemainingShares: () => 20 }));
vi.mock("@/runtime/providers", () => ({ getProvider: () => ({ betting: m.betting, getOrders: m.getOrders,
  resolveLegOutcome: async (_account: unknown, _result: unknown, opts: { fetchVenueOrders: () => Promise<unknown> }) =>
    ({ settlement: m.outcome, orders: m.outcome === "timeout" ? [] : await opts.fetchVenueOrders() }) }) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ updateVenueOrders: async (...args: Parameters<typeof import("./venueOrders")["updateVenueOrders"]>) =>
  (await import("./venueOrders")).updateVenueOrders(...args) }) }));
vi.mock("@/stores/account/balanceRefresh", () => ({ refreshAccountBalance: vi.fn() }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ refreshOrderListAfterBind: vi.fn() }));
vi.mock("@/stores/betting/successMarkers", () => ({ markSuccessfulBet: m.mark }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: 1, setting: { Publisher: m.publisher } }) }));
vi.mock("@/stores/messageStore", () => ({ useMessageStore: () => ({ delayMessage: vi.fn() }) }));
vi.mock("@/services/orderObservation", () => ({ createObservationContext: vi.fn(), observeOption: vi.fn(), observeOrder: vi.fn() }));
vi.mock("@/services/orderObservationEvidence", () => ({ observationFailureEvidence: vi.fn() }));
vi.mock("@/services/polymarketQuotes", () => ({ attachPolymarketDetectionQuote: vi.fn() }));
vi.mock("@/services/predictFunQuotes", () => ({ attachPredictFunDetectionQuote: vi.fn() }));
vi.mock("@/realtime/publishBetting", () => ({ publishBettingEvent: m.publish }));
vi.mock("@/realtime/pubsubClient", () => ({ ensurePubsubConnected: async () => {}, pubsubPublish: m.sent }));
vi.mock("@/shared/orderSound", () => ({ playOrderSuccessSound: async () => {} }));
vi.mock("@/shared/betNotification", () => ({ startBetNotification: () => ({ close: vi.fn() }), showBetResultNotification: vi.fn() }));
vi.mock("@/stores/account/pmOptimisticOrder", () => ({ persistPolymarketMatchedBuyOrder: vi.fn() }));
vi.mock("@/stores/account/pmRejectOrder", () => ({ persistPolymarketExecutionReject: vi.fn() }));

const account = { accountId: 9, provider: "Polymarket", token: "{}" } as PlatformAccount;
const context = () => ({ accounts: [account], findAccount: () => account, getPlatformName: () => "PM" }) as unknown as AccountStoreContext;
const filled = { provider: "Polymarket", orderId: "hash-one", status: "none", pmShares: 20, pmSide: "buy", createAt: 1700000000000 };
const saves = () => m.post.mock.calls.filter(row => row[0] === "Client_SaveOrder").map(row => JSON.parse(row[1].orders));
function input() {
  return Object.assign(new BetOption("Polymarket", "venue-match", "condition", "token", 10, "Home", 2), {
    data: {}, match: { id: 1001, title: "original match" } as BetOption["match"],
    bet: { id: 20, getBetName: () => "original market" } as BetOption["bet"],
  });
}
function receipt() {
  return Object.assign(new BetResult("Polymarket", true), { pending: true, orderId: "hash-one", pmSubmittedAt: 1700000000000,
    request: { order: { side: "BUY", makerAmount: "10000000", maker: "0x1111111111111111111111111111111111111111" } }, saveLog: vi.fn() });
}
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers(); sessionStorage.clear(); m.session = "one"; m.publisher = true; m.outcome = "filled";
  m.post.mockResolvedValue({ success: 1, info: [] }); m.betting.mockImplementation(async () => receipt()); m.getOrders.mockResolvedValue([filled]);
  m.publish.mockImplementation((await vi.importActual<typeof import("@/realtime/publishBetting")>("@/realtime/publishBetting")).publishBettingEvent);
  m.sent.mockResolvedValue(true);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

test.each([false, true])("keeps confirmation queries immediate while a slow Pending write precedes every fill write; deferred=%s", async deferred => {
  let finish!: () => void;
  m.post.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ success: 1 }); }));
  const option = input(); option.deferPostAcceptSettlement = deferred;
  const api = await import("./betGateway");
  const result = await api.placeBet(context(), account, option, 0, { requirePreparedQuote: true });
  const confirmation = deferred ? (await import("@/stores/betting/autoBet/confirmVenueBet")).confirmVenueBet(account, result) : undefined;
  await vi.waitFor(() => expect(m.getOrders).toHaveBeenCalledOnce(), { timeout: 10_000 });
  expect(saves()).toHaveLength(1); expect(saves()[0][0]).toMatchObject({ status: "pending", match: "original match", pmSubmission: { makerAmount: "10000000" } });
  expect(result.orderId).toBe("hash-one"); expect(m.betting).toHaveBeenCalledOnce(); expect(m.mark).not.toHaveBeenCalled();
  finish(); await confirmation; await vi.advanceTimersByTimeAsync(0);
  expect(saves()).toHaveLength(deferred ? 2 : 3);
  for (const rows of saves().slice(1)) expect(rows[0]).toMatchObject(filled);
  expect(m.betting).toHaveBeenCalledOnce();
});

test("a failed Pending write retries the original DTO without letting a confirmation save race ahead", async () => {
  m.post.mockRejectedValueOnce(new Error("temporary database outage"));
  const api = await import("./betGateway"); await api.placeBet(context(), account, input(), 0, { requirePreparedQuote: true });
  await vi.waitFor(() => expect(m.getOrders).toHaveBeenCalledOnce());
  expect(saves()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(501);
  expect(saves()).toHaveLength(4); expect(saves()[1]).toEqual(saves()[0]);
  expect(saves()[2][0]).toMatchObject(filled); expect(m.betting).toHaveBeenCalledOnce(); expect(m.mark).toHaveBeenCalledOnce();
});

test.each([false, true])("broadcasts original client IDs after confirmation, including page reload=%s", async reload => {
  m.outcome = "timeout";
  const option = input();
  const api = await import("./betGateway"); await api.placeBet(context(), account, option, 0, { requirePreparedQuote: true });
  await vi.advanceTimersByTimeAsync(0); expect(m.sent).not.toHaveBeenCalled();
  const stored = JSON.parse(sessionStorage.getItem("PENDING_VENUE_BET_CONFIRM")!);
  expect(stored[0].publishData).toEqual({ provider: "Polymarket", matchId: 1001, betId: 20, target: "Home", betMoney: 10, odds: 2 });
  option.match!.id = 999; option.bet!.id = 999; m.outcome = "filled";
  if (reload) { vi.clearAllTimers(); vi.resetModules(); (await import("./betGateway")).resumePendingVenueConfirmations(context()); }
  await vi.advanceTimersByTimeAsync(1001);
  expect(m.sent).toHaveBeenCalledOnce();
  expect(JSON.parse(m.sent.mock.calls[0][1])).toEqual({ userId: 1, action: "Betting", data: stored[0].publishData });
  expect(m.mark).toHaveBeenCalledExactlyOnceWith(account, 20, "Home", 2);
});

test.each(["disabled", "failed"])("publishing %s does not lose the successful order count", async state => {
  if (state === "disabled") m.publisher = false;
  else m.sent.mockRejectedValue(new Error("pubsub unavailable"));
  const api = await import("./betGateway"); await api.placeBet(context(), account, input(), 0, { requirePreparedQuote: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(m.mark).toHaveBeenCalledOnce(); expect(m.betting).toHaveBeenCalledOnce();
  expect(JSON.parse(sessionStorage.getItem("PENDING_VENUE_BET_CONFIRM")!)).toEqual([]);
});

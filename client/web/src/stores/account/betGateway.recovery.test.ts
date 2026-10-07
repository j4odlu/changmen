import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PlatformAccount } from "@/models/platformAccount";
import type { AccountStoreContext } from "./context";
const mocks = vi.hoisted(() => ({
  scope: "owner-one-wallet", session: "session-one", settle: vi.fn(), notify: vi.fn(), mark: vi.fn(),
  attempts: [] as any[],
  recover: vi.fn(),
}));
vi.mock("@changmen/venue-adapter/polymarket", () => ({ pmSubmitScope: () => mocks.scope, pmAccountSubmitAttempts: () => mocks.attempts,
  pmSubmitMaker: () => "0x1111111111111111111111111111111111111111" }));
vi.mock("@/api/order", () => ({ getPmSubmission: mocks.recover }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => mocks.session, isAuthSessionCurrent: (v: string) => v === mocks.session }));
vi.mock("element-plus", () => ({ ElNotification: mocks.notify }));
vi.mock("@/stores/betting/autoBet/arbLegSettle", () => ({ settleArbLegUntilTerminal: mocks.settle }));
vi.mock("@/stores/betting/successMarkers", () => ({ markSuccessfulBet: mocks.mark }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: 1 }) }));
vi.mock("@/stores/messageStore", () => ({ useMessageStore: () => ({}) }));
vi.mock("@/runtime/providers", () => ({ getProvider: vi.fn() }));
vi.mock("@/services/orderObservation", () => ({ createObservationContext: vi.fn(), observeOption: vi.fn() }));
vi.mock("@/services/orderObservationEvidence", () => ({ observationFailureEvidence: vi.fn() }));
vi.mock("@/domain/polymarket/attachDetectionQuote", () => ({ attachPolymarketDetectionQuote: vi.fn() }));
vi.mock("@/domain/predictfun/attachDetectionQuote", () => ({ attachPredictFunDetectionQuote: vi.fn() }));
vi.mock("@/realtime/publishBetting", () => ({ publishBettingEvent: vi.fn() }));
vi.mock("@/shared/orderSound", () => ({ playOrderSuccessSound: vi.fn() }));
vi.mock("@/shared/a8Notify", () => ({ bettingResultMessageHtml: () => "result" }));
vi.mock("@/stores/account/pmOptimisticOrder", () => ({ persistPolymarketMatchedBuyOrder: vi.fn() }));
vi.mock("@/stores/account/pmRejectOrder", () => ({ persistPolymarketExecutionReject: vi.fn() }));
const account = { accountId: 9, provider: "Polymarket", token: "{}" } as PlatformAccount;
const store = { accounts: [account], findAccount: () => account } as unknown as AccountStoreContext;
const original = { orderHash: "hash-one", side: "BUY", makerAmount: "10000000", submittedAt: 1700000000000,
  recovery: { matchId: "match", venueBetId: "condition", itemId: "token", target: "Home", betMoney: 10, odds: 2 } };
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); sessionStorage.clear();
  mocks.scope = "owner-one-wallet"; mocks.session = "session-one"; mocks.attempts = [];
  mocks.settle.mockResolvedValue({ pendingConfirm: true, rejected: false, orders: [] });
  mocks.recover.mockResolvedValue(null);
});

test.each([true, false])("legacy accepted task resumes only with an owned original submission and matching maker: %s", async (matching) => {
  sessionStorage.setItem("PENDING_VENUE_BET_CONFIRM", JSON.stringify([{
    key: "9:hash-one", accountId: 9, provider: "Polymarket", orderId: "hash-one",
    ...original.recovery, attempts: 0, nextPollAt: 0,
  }]));
  mocks.recover.mockResolvedValue({ orderId: "hash-one", accountId: 9, makerAmount: original.makerAmount,
    stakeUsdc: 10, submittedAt: original.submittedAt,
    makerAddress: matching ? "0x1111111111111111111111111111111111111111" : "0x2222222222222222222222222222222222222222" });
  const api = await import("./betGateway"); api.resumePendingVenueConfirmations(store);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.recover).toHaveBeenCalledWith(9, "hash-one");
  expect(mocks.settle).toHaveBeenCalledTimes(matching ? 1 : 0);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

test("a restored unknown BUY stays bound to the original owner/wallet and submission amount", async () => {
  const api = await import("./betGateway");
  mocks.attempts = [original]; api.resumePendingVenueConfirmations(store);
  mocks.scope = "owner-two-wallet"; mocks.attempts = [];
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.settle).not.toHaveBeenCalled();
  mocks.scope = "owner-one-wallet"; api.resumePendingVenueConfirmations(store);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.settle).toHaveBeenCalledOnce();
  expect(mocks.settle.mock.calls[0][1]).toMatchObject({ pmSubmitUnknown: true, pmSubmittedAt: original.submittedAt,
    request: { order: { side: "BUY", makerAmount: "10000000" } } });
});

test("changing session during confirmation preserves the task and does not count or notify the new session", async () => {
  const api = await import("./betGateway");
  mocks.attempts = [original];
  mocks.settle.mockImplementation(async () => {
    mocks.session = "session-two";
    return { pendingConfirm: false, rejected: false, orders: [] };
  });
  api.resumePendingVenueConfirmations(store); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.notify).not.toHaveBeenCalled(); expect(mocks.mark).not.toHaveBeenCalled();
  expect(JSON.parse(sessionStorage.getItem("PENDING_VENUE_BET_CONFIRM")!)).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("migrating a legacy session task with an exact journal record creates one confirmation flight", async () => {
  sessionStorage.setItem("PENDING_VENUE_BET_CONFIRM", JSON.stringify([{
    key: "9:hash-one", accountId: 9, provider: "Polymarket", orderId: "hash-one",
    ...original.recovery, attempts: 0, nextPollAt: 0,
  }]));
  const api = await import("./betGateway"); mocks.attempts = [original];
  api.resumePendingVenueConfirmations(store); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.settle).toHaveBeenCalledOnce();
  expect(JSON.parse(sessionStorage.getItem("PENDING_VENUE_BET_CONFIRM")!)).toHaveLength(1);
  expect(mocks.settle.mock.calls[0][1]).toMatchObject({ pmSubmitUnknown: true,
    request: { order: { side: "BUY", makerAmount: original.makerAmount } } });
});

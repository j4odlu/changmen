import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PlatformAccount } from "@/models/platformAccount";
import type { AccountStoreContext } from "./context";
const mocks = vi.hoisted(() => ({
  scope: "owner-one-wallet", session: "session-one", settle: vi.fn(), notify: vi.fn(), mark: vi.fn(),
  attempts: [] as any[],
  recover: vi.fn(), pending: vi.fn(), save: vi.fn(),
}));
vi.mock("@changmen/venue-browser/adapter/polymarket", () => ({ pmSubmitScope: () => mocks.scope, pmAccountSubmitAttempts: () => mocks.attempts,
  pmSubmitMaker: () => "0x1111111111111111111111111111111111111111" }));
vi.mock("@/api/order", () => ({ getPmSubmission: mocks.recover, getPendingPmOrders: mocks.pending, saveOrders: mocks.save }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => mocks.session, isAuthSessionCurrent: (v: string) => v === mocks.session }));
vi.mock("element-plus", () => ({ ElNotification: mocks.notify }));
vi.mock("@/stores/betting/autoBet/arbLegSettle", () => ({ settleArbLegUntilTerminal: mocks.settle }));
vi.mock("@/stores/betting/autoBet/confirmVenueBet", () => ({ confirmVenueBet: mocks.settle }));
vi.mock("@/stores/betting/successMarkers", () => ({ markSuccessfulBet: mocks.mark }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: 1 }) }));
vi.mock("@/stores/messageStore", () => ({ useMessageStore: () => ({}) }));
vi.mock("@/runtime/providers", () => ({ getProvider: vi.fn() }));
vi.mock("@/services/orderObservation", () => ({ createObservationContext: vi.fn(), observeOption: vi.fn() }));
vi.mock("@/services/orderObservationEvidence", () => ({ observationFailureEvidence: vi.fn() }));
vi.mock("@/services/polymarketQuotes", () => ({ attachPolymarketDetectionQuote: vi.fn() }));
vi.mock("@/services/predictFunQuotes", () => ({ attachPredictFunDetectionQuote: vi.fn() }));
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
  mocks.pending.mockResolvedValue([]); mocks.save.mockResolvedValue(undefined);
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

const storedReceipt = () => ({ orderId: "hash-one", submission: { orderId: "hash-one", accountId: 9,
  makerAmount: original.makerAmount, stakeUsdc: 10, submittedAt: original.submittedAt,
  makerAddress: "0x1111111111111111111111111111111111111111", takerAmount: "20000000" },
  matchId: "match", conditionId: "condition", tokenId: "token", target: "Home", odds: 2 });

test("RDS hydrates an existing scoped task with missing submission evidence", async () => {
  sessionStorage.setItem("PENDING_VENUE_BET_CONFIRM", JSON.stringify([{
    key: "owner-one-wallet:hash-one", pmScope: mocks.scope, accountId: 9, provider: "Polymarket", orderId: "hash-one",
    ...original.recovery, attempts: 2, nextPollAt: Date.now() + 1000,
  }]));
  mocks.pending.mockResolvedValue([storedReceipt()]);
  const api = await import("./betGateway"); api.resumePendingVenueConfirmations(store);
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.settle.mock.calls[0][1]).toMatchObject({ request: { order: {
    makerAmount: original.makerAmount, takerAmount: "20000000", maker: storedReceipt().submission.makerAddress,
  } } });
  expect(JSON.parse(sessionStorage.getItem("PENDING_VENUE_BET_CONFIRM")!)[0].attempts).toBe(3);
});

test("RDS recovery retries a failed read without requiring an account reload", async () => {
  mocks.pending.mockRejectedValueOnce(new Error("temporary network failure")).mockResolvedValue([storedReceipt()]);
  const api = await import("./betGateway"); api.resumePendingVenueConfirmations(store);
  await vi.advanceTimersByTimeAsync(5001);
  expect(mocks.pending).toHaveBeenCalledTimes(2);
  expect(mocks.settle).toHaveBeenCalledOnce();
});

test("a slow account does not block restoration of other accounts", async () => {
  const second = { ...account, accountId: 10 };
  mocks.pending.mockImplementation((id: number) => id === 9 ? new Promise(() => {}) : Promise.resolve([
    { ...storedReceipt(), submission: { ...storedReceipt().submission, accountId: 10 } },
  ]));
  const api = await import("./betGateway"); api.resumePendingVenueConfirmations({ ...store, accounts: [account, second],
    findAccount: (id: number) => id === 9 ? account : second } as AccountStoreContext);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.pending).toHaveBeenCalledWith(10);
  expect(mocks.settle).toHaveBeenCalledOnce();
});

test("a previous session's in-flight read does not suppress recovery after relogin", async () => {
  mocks.pending.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue([storedReceipt()]);
  const api = await import("./betGateway"); api.resumePendingVenueConfirmations(store);
  mocks.session = "session-two"; api.resumePendingVenueConfirmations(store);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.pending).toHaveBeenCalledTimes(2);
  expect(mocks.settle).toHaveBeenCalledOnce();
});

test.each(["session", "scope"] as const)("changing %s during terminal save preserves the task without notifying or counting", async (field) => {
  mocks.attempts = [{ ...original, recovery: { ...original.recovery, betRowId: 20 } }];
  mocks.settle.mockResolvedValue({ pendingConfirm: false, rejected: false,
    orders: [{ orderId: "hash-one", status: "none", pmShares: 20 }] });
  let finish!: () => void;
  mocks.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const api = await import("./betGateway"); api.resumePendingVenueConfirmations(store);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.save).toHaveBeenCalledOnce();
  mocks[field] = "changed"; finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.notify).not.toHaveBeenCalled(); expect(mocks.mark).not.toHaveBeenCalled();
  expect(JSON.parse(sessionStorage.getItem("PENDING_VENUE_BET_CONFIRM")!)).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("a journal refresh retains the complete signed submission already in the task", async () => {
  sessionStorage.setItem("PENDING_VENUE_BET_CONFIRM", JSON.stringify([{
    key: "owner-one-wallet:hash-one", pmScope: mocks.scope, accountId: 9, provider: "Polymarket", orderId: "hash-one",
    ...original.recovery, attempts: 0, nextPollAt: 0, pmSubmission: storedReceipt().submission,
  }]));
  mocks.attempts = [original];
  const api = await import("./betGateway"); api.resumePendingVenueConfirmations(store);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.settle.mock.calls[0][1]).toMatchObject({ request: { order: {
    maker: storedReceipt().submission.makerAddress, takerAmount: "20000000",
  } } });
});

test("recovery requested after relogin resumes once the previous session's confirmation finishes", async () => {
  let finish!: (value: { pendingConfirm: boolean; rejected: boolean; orders: never[] }) => void;
  mocks.attempts = [original];
  mocks.settle.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const api = await import("./betGateway"); api.resumePendingVenueConfirmations(store);
  await vi.advanceTimersByTimeAsync(0);
  mocks.session = "session-two"; api.resumePendingVenueConfirmations(store);
  finish({ pendingConfirm: true, rejected: false, orders: [] });
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.settle).toHaveBeenCalledTimes(2);
  expect(mocks.notify).not.toHaveBeenCalled(); expect(mocks.mark).not.toHaveBeenCalled();
});

test.each(["session", "scope"] as const)("a failed RDS read stops retrying after %s changes", async (field) => {
  mocks.pending.mockRejectedValue(new Error("network unavailable"));
  const api = await import("./betGateway"); api.resumePendingVenueConfirmations(store);
  await vi.advanceTimersByTimeAsync(0);
  mocks[field] = "changed";
  await vi.advanceTimersByTimeAsync(5001);
  expect(mocks.pending).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test("logout before a scheduled retry stops the timer while retaining the original task", async () => {
  mocks.attempts = [original];
  const context = { ...store, findAccount: () => account as PlatformAccount | undefined };
  const api = await import("./betGateway"); api.resumePendingVenueConfirmations(context);
  await vi.advanceTimersByTimeAsync(0); expect(mocks.settle).toHaveBeenCalledOnce();
  mocks.session = "logged-out"; context.accounts = []; context.findAccount = () => undefined;
  await vi.advanceTimersByTimeAsync(21_000);
  expect(vi.getTimerCount()).toBe(0); expect(mocks.settle).toHaveBeenCalledOnce();
  expect(JSON.parse(sessionStorage.getItem("PENDING_VENUE_BET_CONFIRM")!)).toHaveLength(1);
  mocks.session = "relogged-in"; context.accounts = [account]; context.findAccount = () => account;
  api.resumePendingVenueConfirmations(context); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.settle).toHaveBeenCalledTimes(2);
});

test("pause clears confirmation and RDS retry timers immediately, then resume starts one continuation", async () => {
  mocks.attempts = [original]; mocks.pending.mockRejectedValue(new Error("offline"));
  const api = await import("./betGateway"); api.resumePendingVenueConfirmations(store);
  await vi.advanceTimersByTimeAsync(0); expect(vi.getTimerCount()).toBe(2);
  api.pausePendingVenueConfirmations(); expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(mocks.settle).toHaveBeenCalledOnce(); expect(mocks.pending).toHaveBeenCalledOnce();
  mocks.pending.mockResolvedValue([]); api.resumePendingVenueConfirmations(store);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.settle).toHaveBeenCalledTimes(2); expect(mocks.pending).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(1);
});

test("an in-flight completion after pause cannot notify, save, count or create another timer", async () => {
  let finish!: (value: unknown) => void;
  mocks.attempts = [original]; mocks.settle.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const api = await import("./betGateway"); api.resumePendingVenueConfirmations(store); await vi.advanceTimersByTimeAsync(0);
  api.pausePendingVenueConfirmations(); finish({ pendingConfirm: false, rejected: false, orders: [{ orderId: "hash-one", status: "none", pmShares: 20 }] });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.mark).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  api.resumePendingVenueConfirmations(store); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.settle).toHaveBeenCalledTimes(2);
});

test("pause/resume during the previous confirmation keeps the resumed generation live", async () => {
  let finish!: (value: unknown) => void;
  mocks.attempts = [original]; mocks.settle.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const api = await import("./betGateway"); api.resumePendingVenueConfirmations(store); await vi.advanceTimersByTimeAsync(0);
  api.pausePendingVenueConfirmations(); api.resumePendingVenueConfirmations(store);
  finish({ pendingConfirm: true, rejected: false, orders: [] }); await vi.advanceTimersByTimeAsync(0);
  expect(mocks.settle).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(1);
});

test("a failed legacy submission read after pause does not schedule a stale retry", async () => {
  sessionStorage.setItem("PENDING_VENUE_BET_CONFIRM", JSON.stringify([{ key: "9:hash-one", accountId: 9, provider: "Polymarket",
    orderId: "hash-one", ...original.recovery, attempts: 0, nextPollAt: 0 }]));
  let fail!: (error: Error) => void;
  mocks.recover.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  const api = await import("./betGateway"); api.resumePendingVenueConfirmations(store); await vi.advanceTimersByTimeAsync(0);
  api.pausePendingVenueConfirmations(); fail(new Error("previous session unavailable")); await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0); expect(mocks.settle).not.toHaveBeenCalled();
});

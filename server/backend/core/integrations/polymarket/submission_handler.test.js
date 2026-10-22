import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ owned: vi.fn(), logs: vi.fn(), orders: vi.fn(), pending: vi.fn() }));
vi.mock("@changmen/db", () => ({ fetchPmSubmissionLogs: mocks.logs, fetchOrdersByPlayerOrderIdsStrict: mocks.orders, fetchOrdersByPlayerStrict: mocks.pending }));
vi.mock("../../account/player_ownership.js", () => ({ assertPlayerOwnedByUser: mocks.owned }));
import { handlePmGetSubmission, handlePmGetPendingOrders } from "./submission_handler.js";
const orderId = `0x${"9".repeat(64)}`;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.owned.mockResolvedValue({ ok: true, player: { id: 317, provider: "Polymarket", playerName: "a" } });
  mocks.logs.mockResolvedValue([]); mocks.orders.mockResolvedValue([]); mocks.pending.mockResolvedValue([]);
});
it("rejects unauthenticated, invalid and foreign-account requests before reading logs", async () => {
  expect((await handlePmGetSubmission({ orderId, playerId: 317 }, "")).ok).toBe(false);
  expect((await handlePmGetSubmission({ orderId: "%", playerId: 317 }, "user")).ok).toBe(false);
  mocks.owned.mockResolvedValue({ ok: false, msg: "foreign" });
  expect((await handlePmGetSubmission({ orderId, playerId: 317 }, "user")).ok).toBe(false);
  expect(mocks.logs).not.toHaveBeenCalled();
});
it("scopes lookup to the authenticated user and returns no guessed amount", async () => {
  expect(await handlePmGetSubmission({ orderId, playerId: 317 }, "user")).toEqual({ ok: true, info: null });
  expect(mocks.logs).toHaveBeenCalledWith("user", orderId);
});

it("reads the exact owned stored submission before consulting old logs", async () => {
  const submission = { orderId, accountId: 317, makerAmount: "10000000", stakeUsdc: 10, submittedAt: 1700000000000 };
  mocks.orders.mockResolvedValue([{ provider: "Polymarket", order_id: orderId, raw: { pmSubmission: submission } }]);
  expect(await handlePmGetSubmission({ orderId, playerId: 317 }, "user")).toEqual({ ok: true, info: submission });
  expect(mocks.orders).toHaveBeenCalledWith(317, "user", [orderId]);
  expect(mocks.logs).not.toHaveBeenCalled();
});
it("recovers only owned Pending identities with validated submission evidence and no names or credentials", async () => {
  const submission = { orderId, accountId: 317, makerAmount: "10000000", stakeUsdc: 10, submittedAt: 1700000000000 };
  mocks.pending.mockResolvedValue([{ order_id: orderId, odds: 2, link: 123, raw: {
    pmSubmission: submission, pmConditionId: "c", pmTokenId: "t", venueMatchId: "m", venueItemId: "Away",
    match: "private display name", signature: "secret",
  } }, { order_id: "different", raw: { pmSubmission: submission } }]);
  const response = await handlePmGetPendingOrders({ playerId: 317 }, "user");
  expect(mocks.pending).toHaveBeenCalledWith(317, "user", { pmPendingOnly: true });
  expect(response.info).toEqual([{ orderId, submission, matchId: "m", conditionId: "c", tokenId: "t",
    target: "Away", odds: 2, linkId: 123 }]);
});
it("does not read pending orders for another user/account", async () => {
  mocks.owned.mockResolvedValue({ ok: false, msg: "foreign" });
  expect(await handlePmGetPendingOrders({ playerId: 317 }, "user")).toEqual({ ok: false, msg: "foreign" });
  expect(mocks.pending).not.toHaveBeenCalled();
});

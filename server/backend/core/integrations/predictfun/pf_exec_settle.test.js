import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../account/player_ownership.js", () => ({ assertPlayerOwnedByUser: vi.fn() }));
vi.mock("./pf_player_account.js", () => ({
  applyPendingPfLedgerCredit: vi.fn(), loadPfOrdersStrict: vi.fn(), publishPfBalanceKnown: vi.fn(),
  resolvePfBalance: vi.fn(), retryPendingPfLedgerCredits: vi.fn(),
}));
vi.mock("./pf_order_service.js", () => ({ withHouseOrderLock: vi.fn() }));
vi.mock("./pf_api.js", () => ({ fetchPredictMarket: vi.fn() }));
vi.mock("./pf_orders.js", () => ({ mapPredictOrderToVenueOrder: vi.fn((_official, saved) => ({ ...saved })) }));
vi.mock("./pf_server_order.js", () => ({ upsertPfServerOrder: vi.fn() }));

import { assertPlayerOwnedByUser } from "../../account/player_ownership.js";
import * as account from "./pf_player_account.js";
import { withHouseOrderLock } from "./pf_order_service.js";
import { fetchPredictMarket } from "./pf_api.js";
import { upsertPfServerOrder } from "./pf_server_order.js";
import { settleResolvedPfOrdersForPlayer } from "./pf_exec_settle.js";

const buy = { orderId: "buy", status: "none", betMoney: 20, money: 0, pfSide: "buy", pfMarketId: "m1",
  pfTokenId: "home", pfHoldShares: 30.129, pfBookPrice: 0.6, pfSellState: "open", pfUserSigned: true };
const market = { status: "RESOLVED", outcomes: [{ onChainId: "home", status: "WON" }, { onChainId: "away", status: "LOST" }] };
const empty = { settled: 0, wins: 0, losses: 0, balanceDelta: 0 };
let rows;
beforeEach(() => {
  vi.resetAllMocks();
  rows = [{ ...buy }];
  account.retryPendingPfLedgerCredits.mockResolvedValue({ creditedCount: 0, creditedUsdt: 0 });
  account.loadPfOrdersStrict.mockImplementation(async () => structuredClone(rows));
  account.applyPendingPfLedgerCredit.mockResolvedValue({ ok: true });
  account.resolvePfBalance.mockResolvedValue(123);
  assertPlayerOwnedByUser.mockResolvedValue({ ok: true, player: { id: 1 } });
  withHouseOrderLock.mockImplementation(async fn => fn());
  fetchPredictMarket.mockResolvedValue(market);
  upsertPfServerOrder.mockImplementation(async (_player, saved) => {
    for (const row of saved) rows = rows.map(prev => prev.orderId === row.orderId ? { ...prev, ...row } : prev);
    return true;
  });
});
const settle = () => settleResolvedPfOrdersForPlayer(1, "u1");

describe("PF final market settlement orchestration (external IO mocked)", () => {
  it("self-signed payout persists P&L without crediting the house balance and is idempotent", async () => {
    expect(await settle()).toEqual({ settled: 1, wins: 1, losses: 0, balanceDelta: 30.12 });
    expect(upsertPfServerOrder).toHaveBeenCalledWith(1, [expect.objectContaining({
      money: 10.12, status: "win", pfUserSigned: true, pfSellState: "settled",
      pfLedgerState: "credited", pfPendingCreditUsdt: 0,
    })], "u1");
    expect(account.applyPendingPfLedgerCredit).not.toHaveBeenCalled();
    expect(account.publishPfBalanceKnown).toHaveBeenCalledWith(1, "u1", 123);
    expect(await settle()).toEqual(empty);
    expect(upsertPfServerOrder).toHaveBeenCalledTimes(1);
  });

  it("a losing outcome records cost loss with no cash credit", async () => {
    rows[0].pfTokenId = "away";
    expect(await settle()).toEqual({ settled: 1, wins: 0, losses: 1, balanceDelta: 0 });
    expect(rows[0]).toMatchObject({ money: -20, status: "lose", pfSellState: "settled" });
    expect(account.applyPendingPfLedgerCredit).not.toHaveBeenCalled();
  });

  it("legacy house orders save pending credit before attempting payout, and retries do not duplicate settlement", async () => {
    rows[0].pfUserSigned = false;
    account.applyPendingPfLedgerCredit.mockResolvedValue({ ok: false });
    expect((await settle()).settled).toBe(1);
    expect(rows[0]).toMatchObject({ money: 10.12, pfLedgerState: "pending_credit", pfPendingCreditUsdt: 30.12 });
    expect(upsertPfServerOrder.mock.invocationCallOrder[0]).toBeLessThan(account.applyPendingPfLedgerCredit.mock.invocationCallOrder[0]);
    expect(account.applyPendingPfLedgerCredit).toHaveBeenCalledWith(1, "u1", expect.objectContaining({ pfPendingCreditUsdt: 30.12 }));
    expect(await settle()).toEqual(empty);
    expect(account.retryPendingPfLedgerCredits).toHaveBeenCalledTimes(2);
    expect(account.applyPendingPfLedgerCredit).toHaveBeenCalledTimes(1);
  });

  it.each(["closing", "closed", "settled"])("skips %s positions before fetching a market", async state => {
    rows[0].pfSellState = state;
    expect(await settle()).toEqual(empty);
    expect(fetchPredictMarket).not.toHaveBeenCalled();
    expect(upsertPfServerOrder).not.toHaveBeenCalled();
  });

  it.each(["pending", "reject", "win", "lose"])("skips %s orders", async status => {
    rows[0].status = status;
    expect(await settle()).toEqual(empty);
    expect(upsertPfServerOrder).not.toHaveBeenCalled();
  });

  it.each([undefined, 0, Number.NaN])("never manufactures missing held shares (%s)", async shares => {
    rows[0].pfHoldShares = shares;
    expect(await settle()).toEqual(empty);
    expect(upsertPfServerOrder).not.toHaveBeenCalled();
  });

  it.each(["closing", "closed", "settled"])("rechecks %s written while waiting for the lock", async state => {
    withHouseOrderLock.mockImplementation(async fn => { rows[0].pfSellState = state; return fn(); });
    expect(await settle()).toEqual(empty);
    expect(upsertPfServerOrder).not.toHaveBeenCalled();
  });

  it("does not report a failed order read as an empty settled result", async () => {
    account.loadPfOrdersStrict.mockRejectedValueOnce(Error("read failed"));
    await expect(settle()).rejects.toThrow("read failed");
    expect(fetchPredictMarket).not.toHaveBeenCalled();
  });

  it("does not credit or count an order when persistence returns false", async () => {
    rows[0].pfUserSigned = false;
    upsertPfServerOrder.mockResolvedValue(false);
    expect(await settle()).toEqual(empty);
    expect(account.applyPendingPfLedgerCredit).not.toHaveBeenCalled();
    expect(account.publishPfBalanceKnown).not.toHaveBeenCalled();
  });

  it("uses actual held shares and cost from the locked reread", async () => {
    withHouseOrderLock.mockImplementation(async fn => {
      rows[0].pfHoldShares = 25.987;
      rows[0].betMoney = 18;
      return fn();
    });
    expect(await settle()).toEqual({ settled: 1, wins: 1, losses: 0, balanceDelta: 25.98 });
    expect(rows[0]).toMatchObject({ money: 7.98, status: "win" });
  });

  it("skips when held shares disappeared before acquiring the lock", async () => {
    withHouseOrderLock.mockImplementation(async fn => { rows[0].pfHoldShares = 0; return fn(); });
    expect(await settle()).toEqual(empty);
    expect(upsertPfServerOrder).not.toHaveBeenCalled();
  });

  it.each([{ pfMarketId: "m2" }, { pfTokenId: "away" }, { pfSide: "sell" }])(
    "never applies a fetched market to a changed locked order identity: %j", async patch => {
      withHouseOrderLock.mockImplementation(async fn => { Object.assign(rows[0], patch); return fn(); });
      expect(await settle()).toEqual(empty);
      expect(upsertPfServerOrder).not.toHaveBeenCalled();
    });
});

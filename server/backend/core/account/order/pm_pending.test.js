import { beforeEach, expect, it, vi } from "vitest";
import { saveOrder, rowToOrder } from "../order_store.js";
import { preparePmPendingOrderSave } from "./pm_pending.js";
import { moneyForProfitAggregate, betMoneyForProfitAggregate } from "./profit_cny.js";

const db = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@changmen/db", async () => ({
  ...await import("@changmen/db/order_link_filter.js"),
  fetchOrdersByPlayerOrderIdsStrict: db.read, upsertOrders: db.write,
  backendBindLinkFromCreateAt: (at) => at - 1,
  placeholderLinkFromCreateAt: (at) => at,
}));
const submission = { orderId: "same-order", accountId: 292, makerAmount: "14930000", takerAmount: "22621200",
  stakeUsdc: 14.93, submittedAt: 1792686326358 };
const pending = { provider: "Polymarket", orderId: submission.orderId, pmSubmission: submission,
  match: "Team Liquid vs 1w Team", bet: "[地图2] 获胜", item: "Team Liquid", game: "Dota2",
  pmConditionId: "condition", pmTokenId: "token", pmOrigin: "changmen", pmSide: "buy",
  status: "pending", odds: 1.515, betMoney: 100.031, money: 0, reward: 0,
  createAt: submission.submittedAt, link: submission.submittedAt };
let stored;
beforeEach(() => {
  stored = undefined; vi.clearAllMocks();
  db.read.mockImplementation(async () => stored ? [stored] : []);
  db.write.mockImplementation(async rows => { stored = rows[0]; return true; });
});

it("creates one complete Pending order, then preserves its labels, identity, Link and time on rejection", async () => {
  expect(await saveOrder(292, [pending], "owner")).toBe(true);
  const dto = rowToOrder(stored);
  expect(dto).toMatchObject({ OrderID: "same-order", Status: "Pending", Match: pending.match,
    Bet: pending.bet, Item: pending.item, BetMoney: 100.031 });
  expect(dto.PmSubmittedPrice).toBeUndefined();
  expect(dto.PmFillPrice).toBeUndefined(); expect(dto.PmShares).toBeUndefined();
  expect(moneyForProfitAggregate(stored)).toBe(0); expect(betMoneyForProfitAggregate(stored)).toBe(0);
  await saveOrder(292, [{ provider: "Polymarket", orderId: "same-order", status: "reject", bet: "FOK未成交",
    match: "", item: "Home", odds: 0, money: 0, betMoney: 999, createAt: submission.submittedAt + 10000 }], "owner");
  expect(stored).toMatchObject({ order_id: "same-order", player_id: 292, status: "Reject",
    match: pending.match, bet: pending.bet, item: pending.item, odds: pending.odds,
    link: pending.link, create_at: pending.createAt, bet_money: pending.betMoney });
  expect(stored.raw.pmSubmission).toEqual(submission);
});

it("uses actual fill cost instead of pinning the requested Pending amount, and never regresses a final result", async () => {
  await saveOrder(292, [pending], "owner");
  await saveOrder(292, [{ provider: "Polymarket", orderId: "same-order", status: "none", odds: 1.6,
    betMoney: 98, pmStakeUsdc: 98 / 6.7, pmShares: 23.4, pmFillPrice: 0.625, pmFeeUsdc: 0.02, money: 0 }], "owner");
  expect(stored).toMatchObject({ status: "None", bet_money: 98, match: pending.match, bet: pending.bet });
  expect(stored.raw.pmShares).toBe(23.4);
  const filled = structuredClone(stored);
  await saveOrder(292, [pending], "owner");
  expect(db.write).toHaveBeenCalledTimes(2);
  expect(stored).toEqual(filled);
});

it("does not turn Pending into a position without fill evidence or accept another account's submission", async () => {
  await saveOrder(292, [pending], "owner");
  await saveOrder(292, [{ orderId: "same-order", provider: "Polymarket", status: "none" }], "owner");
  expect(db.write).toHaveBeenCalledOnce();
  await saveOrder(292, [{ orderId: "same-order", provider: "Polymarket", status: "reject" }], "owner");
  await saveOrder(292, [{ orderId: "same-order", provider: "Polymarket", status: "none" }], "owner");
  expect(stored.status).toBe("Reject");
  expect(db.write).toHaveBeenCalledTimes(2);
  expect(() => preparePmPendingOrderSave(undefined, pending, 293, "Polymarket")).toThrow("身份不一致");
});

it("replaces the requested amount with actual zero-fee fill cost when fill evidence arrives after rejection", async () => {
  await saveOrder(292, [pending], "owner");
  await saveOrder(292, [{ provider: "Polymarket", orderId: "same-order", status: "reject",
    pmRejectReason: "unfilled", betMoney: pending.betMoney, money: 0 }], "owner");
  await saveOrder(292, [{ provider: "Polymarket", orderId: "same-order", status: "none",
    betMoney: 98, pmStakeUsdc: 98 / 6.7, pmShares: 23.4, pmFillPrice: 0.625, pmFeeUsdc: 0, money: 0 }], "owner");
  expect(stored).toMatchObject({ status: "None", bet_money: 98, match: pending.match, bet: pending.bet });
  expect(stored.raw).toMatchObject({ betMoney: 98, pmShares: 23.4 });
  expect(stored.raw).not.toHaveProperty("pmRejectReason");
});

it("keeps ordinary venue records on their existing save path", () => {
  const ray = { orderId: "ray", provider: "RAY", status: "pending", betMoney: 100 };
  expect(preparePmPendingOrderSave(undefined, ray, 292, "RAY")).toBe(ray);
});

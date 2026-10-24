import { beforeEach, expect, it, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { VenueOrder } from "@changmen/client-core/contract";
import { enrichPolymarketOrderPrices } from "../../../../polymarket/orders/history/pmOrderPrice";
import { venueOrderFromOrderRow } from "@changmen/venue-browser/polymarket/orders/positions/pmLogicalPosition";

const read = vi.hoisted(() => vi.fn());
vi.mock("@changmen/venue-browser/polymarket/orders/pmClientApi", () => ({ pmGetOrder: read }));
const account = { accountId: 317 } as PlatformAccount;
const id = `0x${"a".repeat(64)}`;
const order = { provider: "Polymarket", orderId: id, pmTokenId: "token", pmSide: "buy",
  odds: 2, pmFillPrice: 0.5044 } as VenueOrder;
beforeEach(() => { read.mockReset(); });

it("uses prices already present in normal order data without changing fill facts", async () => {
  const row = { ...order, pmOrderPrice: 0.51 };
  const [synced] = await enrichPolymarketOrderPrices(account, [row]);
  expect(synced).toBe(row);
  expect(synced).toMatchObject({ pmOrderPrice: 0.51, pmFillPrice: 0.5044, odds: 2 });
  expect(read).not.toHaveBeenCalled();
});

it("retains an already saved official price for the same order and token", async () => {
  const stored = venueOrderFromOrderRow({ OrderID: id, PmTokenId: "token", PmSubmittedPrice: 0.51 });
  const [synced] = await enrichPolymarketOrderPrices(account, [{ ...order, pmOrigin: "external" }], [stored]);
  expect(synced?.pmOrderPrice).toBe(0.51);
  expect(order.pmOrderPrice).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
});

it("leaves missing limits absent across repeated syncs without foreground or background queries", async () => {
  read.mockImplementation(() => new Promise(() => {}));
  expect(await enrichPolymarketOrderPrices(account, [order, order])).toEqual([order, order]);
  await new Promise(resolve => setTimeout(resolve, 0));
  const [synced] = await enrichPolymarketOrderPrices(account, [order]);
  expect(synced?.pmOrderPrice).toBeUndefined();
  expect(synced?.pmFillPrice).toBe(0.5044);
  expect(synced?.odds).toBe(2);
  expect(read).not.toHaveBeenCalled();
});

it.each([
  { ...order, pmTokenId: "different-token", pmOrderPrice: 0.51 },
  { ...order, orderId: `0x${"b".repeat(64)}`, pmOrderPrice: 0.51 },
  ...[undefined, 0, 1, -1, NaN, Infinity].map(pmOrderPrice => ({ ...order, pmOrderPrice })),
])("does not substitute fill odds or a different order/token's price for a missing limit %#", async stored => {
  const [synced] = await enrichPolymarketOrderPrices(account, [order], [stored]);
  expect(synced?.pmOrderPrice).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
});

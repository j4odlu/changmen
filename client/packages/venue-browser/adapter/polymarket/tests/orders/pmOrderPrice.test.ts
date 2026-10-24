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
beforeEach(() => read.mockReset());

it("reads the limit from the official order and preserves independent fill facts", async () => {
  read.mockResolvedValue({ id, side: "BUY", asset_id: "token", price: "0.51", size_matched: "10" });
  const [synced] = await enrichPolymarketOrderPrices(account, [order, order]);
  expect(read).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledWith(account, id);
  expect(synced).toMatchObject({ pmOrderPrice: 0.51, pmFillPrice: 0.5044, odds: 2 });
  expect(order.pmOrderPrice).toBeUndefined();
});

it("reuses saved official prices after an API round trip, including external orders", async () => {
  const stored = venueOrderFromOrderRow({ OrderID: id, PmTokenId: "token", PmSubmittedPrice: 0.51 });
  const [synced] = await enrichPolymarketOrderPrices(account, [{ ...order, pmOrigin: "external" }], [stored]);
  expect(synced?.pmOrderPrice).toBe(0.51);
  expect(await enrichPolymarketOrderPrices(account, [synced!])).toEqual([synced]);
  expect(read).not.toHaveBeenCalled();
});

it.each([
  null, { id, side: "BUY", asset_id: "token" },
  { id: `0x${"b".repeat(64)}`, side: "BUY", asset_id: "token", price: "0.51" },
  { id, side: "SELL", asset_id: "token", price: "0.51" },
  { id, side: "BUY", asset_id: "another-token", price: "0.51" },
  ...["0", "1", "bad", Infinity].map(price => ({ id, side: "BUY", asset_id: "token", price })),
])("does not substitute precheck, fill or signed prices for an invalid order response %#", async row => {
  read.mockResolvedValue(row);
  const [synced] = await enrichPolymarketOrderPrices(account, [order]);
  expect(synced?.pmOrderPrice).toBeUndefined();
  expect(synced?.pmFillPrice).toBe(0.5044);
});

it("keeps fills available on read failure and retries the missing price on the next sync", async () => {
  read.mockRejectedValueOnce(new Error("404"));
  expect(await enrichPolymarketOrderPrices(account, [order])).toEqual([order]);
  read.mockResolvedValueOnce({ id, side: "BUY", asset_id: "token", price: "0.51" });
  expect((await enrichPolymarketOrderPrices(account, [order]))[0]?.pmOrderPrice).toBe(0.51);
});

it("skips local rejection placeholders and sell orders", async () => {
  const rows = [{ ...order, orderId: "local-reject" }, { ...order, pmSide: "sell" as const }];
  expect(await enrichPolymarketOrderPrices(account, rows)).toEqual(rows);
  expect(read).not.toHaveBeenCalled();
});

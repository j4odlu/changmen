import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), register: vi.fn(), convert: vi.fn((value: unknown) => value) }));
vi.mock("@/api/chat", () => ({ getPlayerOrder: mocks.load }));
vi.mock("@changmen/venue-browser/adapter/polymarket", () => ({
  PM_ORDER_FULL_LOOKBACK_MS: 3 * 86400000,
  registerPolymarketStoredVenueOrdersLoader: mocks.register,
  stripPolymarketSellOrders: (rows: unknown[]) => rows,
  venueOrderFromOrderRow: mocks.convert,
}));

it("does not feed the submitted Pending row back into the provider's confirmed-position merger", async () => {
  await import("./polymarketVenueSync");
  const pending = { Type: "Polymarket", Status: "Pending", OrderID: "submitted", BetMoney: 100 };
  const filled = { Type: "Polymarket", Status: "None", OrderID: "filled", BetMoney: 98 };
  mocks.load.mockResolvedValue({ orders: [pending, filled] });
  const read = mocks.register.mock.calls[0]![0];
  expect(await read({ accountId: 292 })).toEqual([filled]);
  expect(mocks.convert).toHaveBeenCalledOnce();
  expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ playerId: 292, includeLogs: false }));
});

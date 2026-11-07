import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import { expect, it, vi } from "vitest";
import {
  loadPolymarketStoredVenueOrders,
  registerPolymarketStoredVenueOrdersLoader,
} from "@changmen/venue-browser/polymarket/orders/history/pmStoredOrders";

it("passes the account to the registered stored-order loader", async () => {
  const account = { accountId: 7001, provider: "Polymarket" } as PlatformAccount;
  const loader = vi.fn().mockResolvedValue([]);
  registerPolymarketStoredVenueOrdersLoader(loader);
  try {
    await loadPolymarketStoredVenueOrders(account);
    expect(loader).toHaveBeenCalledExactlyOnceWith(account);
  } finally {
    registerPolymarketStoredVenueOrdersLoader(async () => []);
  }
});

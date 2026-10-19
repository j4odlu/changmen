import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@changmen/venue-browser/polymarket/transport/transport", () => ({
  polymarketPluginGet: vi.fn(),
}));

import { polymarketPluginGet } from "@changmen/venue-browser/polymarket/transport/transport";
import { fetchPolymarketBalanceViaTransport } from "@changmen/venue-browser/polymarket/wallet/balance";

describe("fetchPolymarketBalanceViaTransport", () => {
  beforeEach(() => {
    vi.mocked(polymarketPluginGet).mockReset();
  });

  it("queries collateral through the shared direct-first transport", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValue({ balance: "12500000" });
    const account = {
      accountId: 47,
      provider: "Polymarket",
      gateway: "https://clob.polymarket.com/",
      token: JSON.stringify({ signatureType: 2 }),
    } as never;

    const result = await fetchPolymarketBalanceViaTransport(account);

    expect(polymarketPluginGet).toHaveBeenCalledWith(
      "https://clob.polymarket.com/balance-allowance?asset_type=COLLATERAL&signature_type=2",
      { account, l2Path: "/balance-allowance" },
    );
    expect(result).toEqual({ balance: 12.5, currency: "USDT" });
  });

  it("returns undefined for malformed upstream balance", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValue({ balance: "not-a-number" });

    await expect(fetchPolymarketBalanceViaTransport({ token: "" } as never)).resolves.toBeUndefined();
  });
});

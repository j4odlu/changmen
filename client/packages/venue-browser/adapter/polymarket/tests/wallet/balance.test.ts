import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@changmen/venue-browser/polymarket/transport/transport", () => ({
  polymarketPluginGet: vi.fn(),
}));

import { polymarketPluginGet } from "@changmen/venue-browser/polymarket/transport/transport";
import { fetchPolymarketBalanceViaTransport, refreshPolymarketPositionAllowance } from "@changmen/venue-browser/polymarket/wallet/balance";
import { POLYGON_POLYMARKET } from "@changmen/venue-browser/polymarket/wallet/contracts";

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
  it.each([[2, "CONDITIONAL", false], [2, "CONDITIONAL", true], [3, "CONDITIONAL-V2", true]] as const)("refreshes protocol %i on the correct ledger (%s, negRisk=%s)", async (protocol, assetType, negRisk) => {
    const account = { accountId: 47, gateway: "https://clob.polymarket.com/", token: JSON.stringify({ signatureType: 3 }) } as never;
    const exchange = protocol === 3 ? POLYGON_POLYMARKET.CTF_EXCHANGE_V3 : negRisk ? POLYGON_POLYMARKET.NEG_RISK_EXCHANGE : POLYGON_POLYMARKET.CTF_EXCHANGE;
    vi.mocked(polymarketPluginGet).mockResolvedValueOnce({}).mockResolvedValueOnce({ allowances: { [exchange.toLowerCase()]: "1" } });
    await refreshPolymarketPositionAllowance(account, "123456789012345678901234567890", protocol, negRisk);
    const [url, options] = vi.mocked(polymarketPluginGet).mock.calls[0]!;
    expect(new URL(url).searchParams.get("asset_type")).toBe(assetType);
    expect(new URL(url).searchParams.get("token_id")).toBe("123456789012345678901234567890");
    expect(new URL(url).searchParams.get("signature_type")).toBe("3");
    expect(options).toEqual({ account, l2Path: "/balance-allowance/update" });
    expect(vi.mocked(polymarketPluginGet).mock.calls[1]?.[1]).toEqual({ account, l2Path: "/balance-allowance" });
  });
  it("propagates cache errors and rejects unsupported identities before making a request", async () => {
    const account = { token: "{}" } as never;
    await expect(refreshPolymarketPositionAllowance(account, "1e20", 3)).rejects.toThrow("资产或协议无效");
    expect(polymarketPluginGet).not.toHaveBeenCalled();
    vi.mocked(polymarketPluginGet).mockResolvedValue({ error: "cache unavailable" });
    await expect(refreshPolymarketPositionAllowance(account, "123", 3)).rejects.toThrow("缓存刷新失败");
  });
  it("does not accept an unrelated ledger's cached approval", async () => {
    vi.mocked(polymarketPluginGet).mockResolvedValueOnce({}).mockResolvedValueOnce({ allowances: { [POLYGON_POLYMARKET.CTF_EXCHANGE]: "1" } });
    await expect(refreshPolymarketPositionAllowance({ token: "{}" } as never, "123", 3)).rejects.toThrow("缓存尚未确认");
  });
});

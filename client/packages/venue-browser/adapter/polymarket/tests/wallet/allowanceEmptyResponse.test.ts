import { beforeEach, expect, it, vi } from "vitest";
import { changmenPmHttpRequest } from "@changmen/client-core/shared/platformHttp";
import { directGet } from "@changmen/client-core/shared/http";
import { refreshPolymarketPositionAllowance } from "@changmen/venue-browser/polymarket/wallet/balance";
import { POLYGON_POLYMARKET } from "@changmen/venue-browser/polymarket/wallet/contracts";
import { pmTransportHttpGet, pmTransportHttpPost } from "@changmen/venue-browser/polymarket/transport/pmTransport";
import { clearPmPublicRoutesForTests } from "@changmen/venue-browser/polymarket/transport/pmPublicRoute";
import { setPmHttpModeForTests } from "@changmen/venue-browser/polymarket/pmTransportMode";
import { resetPmMarketWsSourceModeForTests } from "@changmen/venue-browser/polymarket/pmMarketWsMode";

vi.mock("@changmen/client-core/shared/platformHttp", () => ({
  changmenPmHttpRequest: vi.fn(), changmenPmEsportCall: vi.fn(), parseJsonLoose: JSON.parse,
}));
vi.mock("@changmen/client-core/shared/http", () => ({ directGet: vi.fn(), directPostJson: vi.fn(), directDeleteJson: vi.fn() }));
vi.mock("@changmen/client-core/chrome-plugin/bridge", () => ({ a8PluginGet: vi.fn(), a8PluginPost: vi.fn(), a8PluginDelete: vi.fn() }));

const account = { accountId: 42, gateway: "https://clob.polymarket.com", token: JSON.stringify({ signatureType: 2 }) } as never;
const assetId = "123456789012345678901234567890";
const updateUrl = `https://clob.polymarket.com/balance-allowance/update?asset_type=CONDITIONAL&token_id=${assetId}`;
const options = { account, l2Path: "/balance-allowance/update" };
beforeEach(() => {
  vi.resetAllMocks(); clearPmPublicRoutesForTests();
  setPmHttpModeForTests("vps"); resetPmMarketWsSourceModeForTests("changmen");
});

for (const [protocol, negRisk, exchange, assetType] of [
  [2, false, POLYGON_POLYMARKET.CTF_EXCHANGE, "CONDITIONAL"],
  [2, true, POLYGON_POLYMARKET.NEG_RISK_EXCHANGE, "CONDITIONAL"],
  [3, false, POLYGON_POLYMARKET.CTF_EXCHANGE_V3, "CONDITIONAL-V2"],
] as const) {
  it.each([200, 204])(`protocol ${protocol} negRisk=${negRisk}: empty HTTP %i refresh continues to verify the correct exchange`, async status => {
    vi.mocked(changmenPmHttpRequest).mockImplementation(async input => new URL(input.url).pathname.endsWith("/update")
      ? { status, text: " \r\n" }
      : { status: 200, text: JSON.stringify({ allowances: { [exchange.toLowerCase()]: "1" } }) });
    await expect(refreshPolymarketPositionAllowance(account, assetId, protocol, negRisk)).resolves.toBeUndefined();
    expect(changmenPmHttpRequest).toHaveBeenCalledTimes(2);
    const [update, read] = vi.mocked(changmenPmHttpRequest).mock.calls.map(([input]) => input);
    expect(new URL(update!.url).searchParams.get("asset_type")).toBe(assetType);
    expect(update).toMatchObject({ method: "GET", playerId: 42, l2Path: "/balance-allowance/update" });
    expect(read).toMatchObject({ method: "GET", playerId: 42, l2Path: "/balance-allowance" });
  });
}

it("official direct-read network fallback accepts the void VPS refresh response", async () => {
  resetPmMarketWsSourceModeForTests("official");
  vi.mocked(directGet).mockRejectedValue(Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }));
  vi.mocked(changmenPmHttpRequest).mockResolvedValue({ status: 200, text: "" });
  await expect(pmTransportHttpGet(updateUrl, options)).resolves.toBeUndefined();
  expect(changmenPmHttpRequest).toHaveBeenCalledOnce();
});

it("a successful void refresh still requires a positive verified allowance", async () => {
  vi.mocked(changmenPmHttpRequest).mockResolvedValueOnce({ status: 200, text: "" })
    .mockResolvedValueOnce({ status: 200, text: JSON.stringify({ allowances: { [POLYGON_POLYMARKET.CTF_EXCHANGE]: "0" } }) });
  await expect(refreshPolymarketPositionAllowance(account, assetId, 2)).rejects.toThrow("仓位授权缓存尚未确认");
});

it("an upstream refresh failure preserves its HTTP metadata and stops before the allowance read", async () => {
  const error = Object.assign(new Error("HTTP 429"), { response: { status: 429, headers: { "retry-after": "3" } } });
  vi.mocked(changmenPmHttpRequest).mockRejectedValue(error);
  await expect(refreshPolymarketPositionAllowance(account, assetId, 2)).rejects.toBe(error);
  expect(changmenPmHttpRequest).toHaveBeenCalledOnce();
});

it("empty balance, book and submit responses remain errors", async () => {
  vi.mocked(changmenPmHttpRequest).mockResolvedValue({ status: 200, text: "" });
  await expect(pmTransportHttpGet("https://clob.polymarket.com/balance-allowance", { account, l2Path: "/balance-allowance" })).rejects.toThrow("API 无响应");
  await expect(pmTransportHttpGet("https://clob.polymarket.com/book?token_id=123")).rejects.toThrow("API 无响应");
  await expect(pmTransportHttpPost("https://clob.polymarket.com/order", {}, { account, l2Path: "/order" })).rejects.toThrow("API 无响应");
});

it("an empty refresh-shaped POST, mismatched path or non-success status cannot pass", async () => {
  vi.mocked(changmenPmHttpRequest).mockResolvedValue({ status: 200, text: "" });
  await expect(pmTransportHttpPost(updateUrl, {}, options)).rejects.toThrow("API 无响应");
  await expect(pmTransportHttpGet("https://clob.polymarket.com/balance-allowance", options)).rejects.toThrow("API 无响应");
  vi.mocked(changmenPmHttpRequest).mockResolvedValue({ status: 500, text: "" });
  await expect(pmTransportHttpGet(updateUrl, options)).rejects.toThrow("API 无响应");
});

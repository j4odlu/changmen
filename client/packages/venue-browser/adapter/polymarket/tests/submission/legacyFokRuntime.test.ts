import { beforeEach, expect, it, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { BetOption } from "@changmen/client-core/models/betOption";
import { runPmBuyPreflight, matchesPmPreflightBinding } from "@changmen/venue-browser/polymarket/submission/preflight/pmBuyPreflight";
import { clearPolymarketOrderClientCacheForTests, preparePolymarketAccountRuntimes,
  retainPolymarketAccountRuntimes } from "@changmen/venue-browser/polymarket/submission/client/pmOrderClientCache";

const clock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@changmen/venue-browser/polymarket/orders/pmClientApi", () => ({ pmPrepareSubmit: clock }));
vi.mock("@changmen/venue-browser/polymarket/submission/preflight/legacy/pmBetGuard", () => ({ resolvePolymarketBetBlockReason: async () => null }));
vi.mock("@changmen/venue-browser/polymarket/submission/preflight/pmBetGuard", () => ({ resolvePolymarketBetBlockReason: async () => null }));

// 公共测试钱包；真实 SDK 本地初始化，HTTP 与下单均不调用。
const config = { walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  apiCreds: { apiKey: "test", secret: "c2VjcmV0", passphrase: "test" } };
const account = () => ({ accountId: 47, provider: "Polymarket", token: JSON.stringify(config) } as PlatformAccount);
const binding = (a: PlatformAccount) => JSON.stringify([a.accountId, a.token, a.gateway]);
function check(a: PlatformAccount, role: "execute" | "precheckOnly" = "execute", sportMode?: "legacy") {
  return runPmBuyPreflight(a, { itemId: "123" } as BetOption, {
    sportMode, role, gateway: "https://clob.polymarket.com", market: async () => "book",
    runtimeBinding: () => binding(a), missingCredentialsMessage: "missing credentials",
  });
}
beforeEach(() => { clearPolymarketOrderClientCacheForTests(); clock.mockClear(); });

it("legacy cold preparation and concurrent account loading share an executable, stable session", async () => {
  const a = account();
  const loading = preparePolymarketAccountRuntimes([a]);
  const first = await check(a, "execute", "legacy");
  await loading;
  const warm = await check(a, "execute", "legacy");
  expect(first.runtime.status).toBe("fulfilled");
  expect(warm.runtime.status).toBe("fulfilled");
  if (first.runtime.status !== "fulfilled" || warm.runtime.status !== "fulfilled") throw new Error("runtime failed");
  expect(first.runtime.value!.runtime).toBe(warm.runtime.value!.runtime);
  expect(matchesPmPreflightBinding(a, first.runtime.value!, () => binding(a))).toBe(true);
  expect(warm.runtime.value!.cacheHit).toBe(true);
});

it("legacy can retry after an account preparation failure once credentials are corrected", async () => {
  const a = account();
  a.token = JSON.stringify({ ...config, walletAddress: "0x0000000000000000000000000000000000000001" });
  expect((await preparePolymarketAccountRuntimes([a]))[0].status).toBe("rejected");
  a.token = JSON.stringify(config);
  const result = await check(a, "execute", "legacy");
  expect(result.runtime.status).toBe("fulfilled");
});

it.each(["lock", "remove", "replace"])("%s during legacy initialization cannot restore a revoked signer", async action => {
  const a = account();
  const checking = check(a, "execute", "legacy");
  if (action === "lock") clearPolymarketOrderClientCacheForTests();
  else retainPolymarketAccountRuntimes(action === "remove" ? [] : [{ ...a, token: "{}" }]);
  const result = await checking;
  expect(result.runtime.status).toBe("rejected");
});

it("changing credentials while initializing cannot bind the old signer to the new account", async () => {
  const a = account();
  const checking = check(a, "execute", "legacy");
  a.token = JSON.stringify({ ...config, apiCreds: { ...config.apiCreds, apiKey: "replacement" } });
  const result = await checking;
  expect(result.runtime.status).toBe("fulfilled");
  if (result.runtime.status !== "fulfilled") throw new Error("runtime failed");
  expect(matchesPmPreflightBinding(a, result.runtime.value!, () => binding(a))).toBe(false);
});

it("legacy precheck-only still works without wallet credentials or clock preparation", async () => {
  const a = account(); a.token = "{}";
  expect((await check(a, "precheckOnly", "legacy")).runtime).toEqual({ status: "fulfilled", value: null });
  expect(clock).not.toHaveBeenCalled();
});

it("GTC retains explicit signer preparation and does not inherit legacy auto initialization", async () => {
  const a = account();
  expect((await check(a)).runtime.status).toBe("rejected");
  await preparePolymarketAccountRuntimes([a]);
  expect((await check(a)).runtime.status).toBe("fulfilled");
});

import { afterEach, expect, it, vi } from "vitest";
import { fetchPolymarketRelayerStatus } from "./relayer";

afterEach(() => vi.unstubAllGlobals());
it("sends the API Cookie and CSRF headers on cross-origin relayer status without a JWT", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ configured: true }) });
  vi.stubGlobal("fetch", fetch);
  expect(await fetchPolymarketRelayerStatus("https://api.changmen.fun", "", { "X-Changmen-Auth": "cookie", "X-CSRF-Token": "csrf" })).toEqual({ configured: true });
  expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "include", headers: { "X-CSRF-Token": "csrf" } });
  expect(fetch.mock.calls[0][1].headers.token).toBeUndefined();
});

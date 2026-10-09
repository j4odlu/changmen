import { afterEach, expect, test, vi } from "vitest";
import { fetchPolymarketTradesSince, fetchPolymarketTradesById } from "./clob_l2.js";
const token = JSON.stringify({ address: "0x123", apiKey: "test", secret: "c2VjcmV0", passphrase: "test" });
afterEach(() => vi.unstubAllGlobals());
test.each([401, 429, 503])("trade reads preserve upstream HTTP %s through both query forms", async status => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status })));
  await expect(fetchPolymarketTradesSince({ token, afterSec: 1700000000 })).rejects.toMatchObject({ status });
  await expect(fetchPolymarketTradesById({ token, tradeId: "trade" })).rejects.toMatchObject({ status });
});

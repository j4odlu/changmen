import { describe, expect, it, vi } from "vitest";
import { fetchPolymarketActivityV2 } from "./pmActivityV2";

// Opt-in read-only smoke against the public wallet in Polymarket's own docs.
// No account credentials, orders, or database writes.
vi.mock("./transport", () => ({
  polymarketPluginGet: async (url: string) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok)
      throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
}));

describe.skipIf(process.env.PM_DATA_V2_LIVE !== "1")("activity v2 public live smoke", () => {
  it("matches 200 legacy BUY records, with fees, across real cursor pages", async () => {
    const user = "0x983eedfbd75803602e4a6e6ea9aab6dc6b9c6748";
    const res = await fetch(`https://data-api.polymarket.com/activity?user=${user}&limit=200&type=TRADE&side=BUY`, {
      signal: AbortSignal.timeout(10000),
    });
    expect(res.status).toBe(200);
    const old = await res.json() as Array<{
      timestamp: number;
      transactionHash: string;
      asset: string;
      conditionId: string;
      size: number;
      price: number;
      usdcSize: number;
    }>;
    expect(old).toHaveLength(200);
    const rows = await fetchPolymarketActivityV2(user, {
      limit: 37,
      startSec: Math.min(...old.map(r => r.timestamp)),
      endSec: Math.max(...old.map(r => r.timestamp)),
    });
    // Timestamp ties may include additional rows beyond the old page's cap.
    for (const legacy of old) {
      const row = rows.find(r => r.transactionHash === legacy.transactionHash && r.asset === legacy.asset && r.size === legacy.size);
      expect(row).toMatchObject({
        conditionId: legacy.conditionId,
        timestamp: legacy.timestamp,
        price: legacy.price,
        usdcSize: legacy.usdcSize,
      });
    }
    const fees = old.filter(r => r.usdcSize - r.price * r.size > 0.00001).length;
    expect(fees).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.info(`[PM v2 live] legacy=${old.length} v2=${rows.length} matched=${old.length} feeRows=${fees} pageSize=37`);
  }, 30000);
});

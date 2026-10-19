import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  });
}

function pmAccount(accountId = 42): PlatformAccount {
  return { accountId, provider: "Polymarket" } as PlatformAccount;
}

describe("pmOrigin", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("marks and detects changmen order ids per player", async () => {
    const {
      isPolymarketChangmenOrder,
      markPolymarketChangmenOrder,
    } = await import("@changmen/venue-browser/polymarket/orders/positions/pmOrigin");
    markPolymarketChangmenOrder(42, "0xabc");
    expect(isPolymarketChangmenOrder(42, "0xabc")).toBe(true);
    expect(isPolymarketChangmenOrder(42, "0xother")).toBe(false);
    expect(isPolymarketChangmenOrder(99, "0xabc")).toBe(false);
  });

  it("resolvePolymarketOrderOrigin prefers stored changmen", async () => {
    const {
      markPolymarketChangmenOrder,
      resolvePolymarketOrderOrigin,
    } = await import("@changmen/venue-browser/polymarket/orders/positions/pmOrigin");
    expect(resolvePolymarketOrderOrigin(1, "0x1", "changmen")).toBe("changmen");
    expect(resolvePolymarketOrderOrigin(1, "0x1", "external")).toBe("external");
    markPolymarketChangmenOrder(1, "0x2");
    expect(resolvePolymarketOrderOrigin(1, "0x2", "external")).toBe("changmen");
  });

  it("applyPolymarketOrderOrigins tags sync rows", async () => {
    const {
      applyPolymarketOrderOrigins,
      markPolymarketChangmenOrder,
    } = await import("@changmen/venue-browser/polymarket/orders/positions/pmOrigin");
    markPolymarketChangmenOrder(7, "0xcm");
    const out = applyPolymarketOrderOrigins(pmAccount(7), [
      {
        provider: "Polymarket",
        orderId: "0xcm",
        odds: 2,
        createAt: 1,
        betMoney: 10,
        reward: 0,
        money: 0,
        status: "none",
        game: "",
        match: "m",
        bet: "b",
        item: "i",
      },
      {
        provider: "Polymarket",
        orderId: "0xext",
        odds: 2,
        createAt: 2,
        betMoney: 10,
        reward: 0,
        money: 0,
        status: "none",
        game: "",
        match: "m2",
        bet: "b2",
        item: "i2",
      },
    ]);
    expect(out[0]?.pmOrigin).toBe("changmen");
    expect(out[1]?.pmOrigin).toBe("external");
  });
});

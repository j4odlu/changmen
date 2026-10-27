import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map();

vi.mock("@changmen/storage/json_file_store", () => ({
  readJsonFile: (name, fallback) => (mem.has(name) ? mem.get(name) : fallback),
  writeJsonFile: (name, data) => {
    mem.set(name, data);
  },
}));

describe("pf_changmen_fee_config (会员下线)", () => {
  beforeEach(() => {
    mem.clear();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("always returns 0 fee regardless of env", async () => {
    vi.stubEnv("PF_CHANGMEN_BUY_FEE_RATE_BPS", "50");
    vi.stubEnv("PF_CHANGMEN_SELL_FEE_RATE_BPS", "150");
    const mod = await import("./pf_changmen_fee_config.js");
    expect(mod.resolvePfChangmenBuyFeeRateBps()).toBe(0);
    expect(mod.resolvePfChangmenSellFeeRateBps()).toBe(0);
    expect(mod.resolvePfChangmenFeeRateBps()).toBe(0);
    expect(mod.getPfChangmenFeeConfig()).toMatchObject({
      buyFeeRateBps: 0,
      sellFeeRateBps: 0,
      removed: true,
    });
  });

  it("save is no-op and stays at 0", async () => {
    const mod = await import("./pf_changmen_fee_config.js");
    const saved = mod.savePfChangmenFeeConfig({
      buyFeeRatePercent: 1.5,
      sellFeeRatePercent: 2,
    });
    expect(saved.buyFeeRateBps).toBe(0);
    expect(saved.sellFeeRateBps).toBe(0);
    expect(mod.getPfChangmenFeeConfig().buyFeeRateBps).toBe(0);
  });
});

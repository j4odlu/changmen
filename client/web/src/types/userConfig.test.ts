import type { UserConfig } from "@/types/userConfig";
import { describe, expect, it } from "vitest";
import {
  ALL_PLATFORMS,
  mergeProviderSortValue,
  mergeUserConfig,

} from "@/types/userConfig";

describe("mergeProviderSortValue", () => {
  it("appends missing platforms without reordering existing entries", () => {
    const [first, second] = ALL_PLATFORMS;
    const merged = mergeProviderSortValue([second, first]);
    expect(merged.slice(0, 2)).toEqual([second, first]);
    expect(merged).toEqual(expect.arrayContaining(ALL_PLATFORMS));
    expect(new Set(merged).size).toBe(ALL_PLATFORMS.length);
  });

  it("is applied when loading USERCONFIG via mergeUserConfig", () => {
    const [only] = ALL_PLATFORMS;
    const cfg = mergeUserConfig({ providerSortValue: [only] });
    expect(cfg.providerSortValue[0]).toBe(only);
    expect(cfg.providerSortValue).toEqual(expect.arrayContaining(ALL_PLATFORMS));
  });
});

describe("mergeUserConfig legacy fields", () => {
  it("defaults old configs to buy mode and preserves total mode", () => {
    expect(mergeUserConfig(null).betMoneyMode).toBe("buy");
    expect(mergeUserConfig({ betMoney: 150 }).betMoneyMode).toBe("buy");
    expect(mergeUserConfig({ betMoneyMode: "total" }).betMoneyMode).toBe("total");
    expect(mergeUserConfig({ betMoneyMode: "invalid" } as unknown as Partial<UserConfig>).betMoneyMode).toBe("buy");
  });

  it("strips deprecated arbDetectEngine and arbExecuteEngine", () => {
    const cfg = mergeUserConfig({
      arbDetectEngine: "kakaxi",
      arbExecuteEngine: "a8",
    } as unknown as Partial<UserConfig>);
    expect(cfg).not.toHaveProperty("arbDetectEngine");
    expect(cfg).not.toHaveProperty("arbExecuteEngine");
    expect(cfg.betting).toBe(false);
  });

  it("defaults and normalizes valueBetMoney", () => {
    expect(mergeUserConfig(null).valueBetMoney).toBe(100);
    expect(mergeUserConfig({ valueBetMoney: 80 }).valueBetMoney).toBe(80);
    expect(mergeUserConfig({ valueBetMoney: -1 } as Partial<UserConfig>).valueBetMoney).toBe(100);
    expect(mergeUserConfig({ valueBetMoney: 0 }).valueBetMoney).toBe(0);
  });

  it("defaults valueBetConfirm to true", () => {
    expect(mergeUserConfig(null).valueBetConfirm).toBe(true);
    expect(mergeUserConfig({ valueBetConfirm: false }).valueBetConfirm).toBe(false);
  });
});

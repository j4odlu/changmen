import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@/models/platformAccount";
import type { AccountStoreContext } from "./context";
import { checkBetting } from "./betGateway";
import { useOddsStore } from "@/stores/oddsStore";
import { capturePmTickBufferQuote } from "@/domain/polymarket/tickBufferQuote";
import { notePmTickBufferBook, clearPmTickBufferMetadata, setPmArbPriceBufferPrefs,
  resetPmArbPriceBufferPrefsForTests } from "@changmen/venue-adapter/polymarket";

const check = vi.hoisted(() => vi.fn());
vi.mock("@/runtime/providers", () => ({ getProvider: () => ({ checkBet: check }) }));
vi.mock("@/security/pmVault", () => ({ isVaultKeyProvider: () => false }));

const account = { accountId: 1, provider: "Polymarket", currency: "CNY" } as PlatformAccount;
const store = {} as AccountStoreContext;
const leg = (id = "t", odds = 1.960) => {
  const option = new BetOption("Polymarket", "m", "b", id, 100, "Home", odds);
  option.saveLog = vi.fn();
  return option;
};
beforeEach(() => {
  setActivePinia(createPinia()); clearPmTickBufferMetadata(); resetPmArbPriceBufferPrefsForTests();
  check.mockReset().mockImplementation(async (_account, option) => {
    option.data = { prepared: true };
    return option;
  });
});
afterEach(() => { clearPmTickBufferMetadata(); resetPmArbPriceBufferPrefsForTests(); });
it("sport/POD prechecks keep their separate quote with the esports tick buffer enabled", async () => {
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01, mode: "tick" });
  const option = leg("sport-only", 2);
  const result = await checkBetting(store, account, option, { pmQuoteScope: "sport" });
  expect(result.checkError).toBeUndefined();
  expect(result.odds).toBe(2);
  expect(result.data).toEqual({ prepared: true });
  expect(check).toHaveBeenCalledOnce();
  expect(check.mock.calls[0]![1]).toBe(option);
});
it("rejected tick metadata returns an empty precheck and never reaches the adapter", async () => {
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01, mode: "tick" });
  notePmTickBufferBook("t", { asset_id: "t", tick_size: "0.01" });
  useOddsStore().save("Polymarket", { id: "t", odds: 2, clobPrice: 0.5, isLock: false, time: Date.now() });
  const option = leg(); capturePmTickBufferQuote(option);
  option.data!.pmTickQuote = undefined;
  const result = await checkBetting(store, account, option);
  expect(result.data).toBeNull();
  expect(result.checkError).toContain("报价缺失或不匹配");
  expect(check).not.toHaveBeenCalled();
});
it.each([undefined, "percent"] as const)("sport scope preserves legacy percentage caps in %s mode", async mode => {
  setPmArbPriceBufferPrefs({ enabled: true, multiplier: 1.01, mode });
  useOddsStore().save("Polymarket", { id: "t", odds: 2, clobPrice: 0.5, isLock: false, time: Date.now() });
  check.mockImplementation(async (_account, option) => option);
  const result = await checkBetting(store, account, leg("t", 1.980), { pmQuoteScope: "sport" });
  expect(result.checkError).toBeUndefined();
  expect(result.data).toEqual({ detectionClobPrice: 0.505, detectionMaxPrice: 0.505 });
});

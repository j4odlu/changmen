import { createPinia, setActivePinia } from "pinia";
import { expect, test, vi } from "vitest";
const m = vi.hoisted(() => ({ pause: vi.fn(), stop: vi.fn() }));
vi.mock("@/stores/account/betGateway", () => ({ checkBetting: vi.fn(), placeBet: vi.fn(), pausePendingVenueConfirmations: m.pause }));
vi.mock("@/stores/account/balanceRefresh", () => ({ stopBalanceRefreshLoop: m.stop }));
vi.mock("@/stores/account/accountCrud", () => ({}));
import { useAccountStore } from "@/stores/accountStore";

test("account session reset pauses pending confirmations synchronously before discarding accounts", () => {
  setActivePinia(createPinia());
  const store = useAccountStore(); store.accounts = [{ accountId: 9 } as never];
  m.pause.mockImplementation(() => { expect(store.accounts).toHaveLength(1); });
  store.resetSession();
  expect(m.stop).toHaveBeenCalledOnce(); expect(m.pause).toHaveBeenCalledOnce();
  expect(store.accounts).toEqual([]); expect(store.loaded).toBe(false);
});

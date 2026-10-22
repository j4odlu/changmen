import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { useOrderStore } from "./orderStore";

const mocks = vi.hoisted(() => ({ accounts: [{ accountId: 292, balance: 1000 }] as any[] }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ accounts: mocks.accounts }) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: "owner" }) }));
vi.mock("@/stores/messageStore", () => ({ useMessageStore: () => ({ orderReportMessage: vi.fn() }) }));
beforeEach(() => { setActivePinia(createPinia()); mocks.accounts = [{ accountId: 292, balance: 1000 }]; });

it("counts Pending as neither a successful order nor an open position, then counts the confirmed same order once", () => {
  const store = useOrderStore();
  const pending = { OrderID: "same-order", Type: "Polymarket", Status: "Pending", PlayerID: 292,
    BetMoney: 100, Money: 900, Link: Date.now(), CreateAt: Date.now(), PmSide: "buy" as const };
  store.updateTodayProfit([pending]);
  expect(mocks.accounts[0]).toMatchObject({ today: 0, todayOrder: 0, orderCount: 0, unsettle: 0, winBalance: 1000 });
  store.updateTodayProfit([{ ...pending, Status: "None", Money: 0, PmShares: 20 }]);
  expect(mocks.accounts[0]).toMatchObject({ today: 0, todayOrder: 1, orderCount: 1, unsettle: 1 });
});

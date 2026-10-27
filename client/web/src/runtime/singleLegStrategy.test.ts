import { effectScope, isReadonly, nextTick, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderRow } from "@/types/order";

const stores = vi.hoisted(() => ({
  user: {} as { isLoggedIn: boolean; userId: string },
  accounts: {} as { adminWorkspacePreview: boolean },
  orders: {} as { orders: Map<number, OrderRow[]> },
}));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => stores.user }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => stores.accounts }));
vi.mock("@/stores/orderStore", () => ({ useOrderStore: () => stores.orders }));

import { pendingSingleLegPositions, setupSingleLegStrategy, singleLegPositions } from "./singleLegStrategy";

const time = 1800000000000;
const row = (patch: Partial<OrderRow> = {}): OrderRow => ({ OrderID: "one", PlayerID: 1, Type: "OB", Link: -time, Status: "None", ...patch });
let scope: ReturnType<typeof effectScope>;

beforeEach(() => {
  stores.user = reactive({ isLoggedIn: true, userId: "u1" });
  stores.accounts = reactive({ adminWorkspacePreview: false });
  stores.orders = reactive({ orders: new Map<number, OrderRow[]>() });
  scope = effectScope();
});
afterEach(() => { scope.stop(); vi.restoreAllMocks(); });

describe("single-leg frontend monitor", () => {
  it("filters LOS/9999 and calls the independent strategy with readonly snapshots", () => {
    stores.orders.orders.set(-time, [row(), row({ OrderID: "los", Link: -(6000000000000000 + time) }),
      row({ OrderID: "arb", Link: time }), row({ OrderID: "ev", Link: -(7000000000000000 + time) }),
      row({ OrderID: "manual", Link: 0 }), row({ OrderID: "sell", PmSide: "sell" }),
      row({ OrderID: "pf-sell", PfSide: "sell" }), row({ OrderID: "preview", DisplayOnly: true })]);
    const strategy = vi.fn();
    scope.run(() => setupSingleLegStrategy(strategy));
    expect(singleLegPositions.value.map(p => p.OrderID)).toEqual(["one", "los"]);
    expect(strategy).toHaveBeenCalledOnce();
    expect(isReadonly(strategy.mock.calls[0]![0])).toBe(true);
  });

  it("follows the current cache, without retaining a separate history or changing the source", async () => {
    stores.orders.orders.set(-time, [row({ Player: reactive({ UserName: "player" }) })]);
    scope.run(() => setupSingleLegStrategy());
    const saved = singleLegPositions.value;
    stores.orders.orders.get(-time)![0]!.Status = "Win";
    await nextTick();
    expect(singleLegPositions.value[0]!.Status).toBe("Win");
    expect(saved[0]!.Status).toBe("None");
    expect(saved[0]!.Player?.UserName).toBe("player");
    stores.orders.orders = new Map();
    await nextTick();
    expect(singleLegPositions.value).toEqual([]);
  });

  it("clears on owner change and accepts new data in the same tick", async () => {
    stores.orders.orders.set(-time, [row()]);
    scope.run(() => setupSingleLegStrategy());
    stores.user.userId = "u2";
    expect(singleLegPositions.value).toEqual([]);
    stores.orders.orders = new Map([[-time, [row({ OrderID: "u2" })]]]);
    await nextTick();
    expect(singleLegPositions.value[0]!.OrderID).toBe("u2");
    stores.user.isLoggedIn = false;
    expect(singleLegPositions.value).toEqual([]);
  });

  it("ignores administrator preview and resumes with restored own cache", async () => {
    stores.accounts.adminWorkspacePreview = true;
    scope.run(() => setupSingleLegStrategy());
    stores.accounts.adminWorkspacePreview = false;
    stores.orders.orders = new Map([[-time, [row()]]]);
    await nextTick();
    expect(singleLegPositions.value[0]!.OrderID).toBe("one");
  });

  it("isolates synchronous and asynchronous strategy errors", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const strategy = vi.fn().mockImplementationOnce(() => { throw Error("strategy"); })
      .mockRejectedValueOnce(Error("async strategy"));
    expect(() => scope.run(() => setupSingleLegStrategy(strategy))).not.toThrow();
    stores.orders.orders.set(-time, [row()]);
    await nextTick();
    await Promise.resolve();
    expect(warning).toHaveBeenCalledTimes(2);
    expect(singleLegPositions.value[0]!.OrderID).toBe("one");
  });

  it("stops observing and clears the list on disposal", async () => {
    const strategy = vi.fn();
    scope.run(() => setupSingleLegStrategy(strategy));
    scope.stop();
    strategy.mockClear();
    stores.orders.orders.set(-time, [row()]);
    await nextTick();
    expect(strategy).not.toHaveBeenCalled();
    expect(singleLegPositions.value).toEqual([]);
  });

  it("lists only unresolved orders and retains PM open shares despite heuristic Win/Lose", () => {
    stores.orders.orders.set(-time, [row(), row({ OrderID: "pending", Status: "Pending" }),
      ...["Win", "Lose", "Return", "Reject"].map(Status => row({ OrderID: Status, Status })),
      row({ OrderID: "pm-closed", Type: "Polymarket", PmSellState: "closed", PmShares: 10 }),
      row({ OrderID: "pm-settled", Type: "Polymarket", PmSellState: "settled", PmShares: 10 }),
      row({ OrderID: "pm-sold", Type: "Polymarket", PmShares: 10, PmAttributedSellShares: 10 }),
      row({ OrderID: "pf-closed", Type: "PredictFun", PfSellState: "closed" }),
      row({ OrderID: "pf-settled", Type: "PredictFun", PfSellState: "settled" }),
      row({ OrderID: "pm-still-open", Type: "Polymarket", Status: "Win", PmShares: 10 })]);
    scope.run(() => setupSingleLegStrategy());
    expect(pendingSingleLegPositions.value.map(p => p.OrderID)).toEqual(["one", "pending", "pm-still-open"]);
    expect(singleLegPositions.value).toHaveLength(12);
  });
});

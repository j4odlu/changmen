import { beforeEach, describe, expect, it, vi } from "vitest";
import { processLoseOrders } from "./loseOrder";
import { runLoseOrderExecution } from "./loseOrderExecution";

const state = vi.hoisted(() => ({
  calls: [] as string[],
  user: { config: {}, extensionPrefs: { arbFailAutoSell: { enabled: false } } },
  match: { matchs: [] },
  account: {},
  queue: {},
  active: { runs: new Map<number, { legs: { target: string; status: string; side: "A" | "B" }[] }>() },
  sync: vi.fn(),
  filter: vi.fn(),
  autoSell: vi.fn(async () => false),
}));

vi.mock("./loseOrderExecution", () => ({ runLoseOrderExecution: vi.fn(async () => {}) }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => { state.calls.push("user"); return state.user; } }));
vi.mock("@/stores/matchStore", () => ({ useMatchStore: () => { state.calls.push("match"); return state.match; } }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => { state.calls.push("account"); return state.account; } }));
vi.mock("@/stores/loseOrderStore", () => ({ useLoseOrderStore: () => { state.calls.push("queue"); return state.queue; } }));
vi.mock("@/stores/activeBetRunStore", () => ({ useActiveBetRunStore: () => { state.calls.push("active"); return state.active; } }));
vi.mock("@/stores/betting/activeBetRunSync", () => ({ syncActiveBetMakeupAttempt: state.sync }));
vi.mock("@/stores/betting/betFilters", () => ({ passesMakeUpAccount: state.filter }));
vi.mock("@/extensions/arbBet/arbFailAutoSell", () => ({ maybeArbFailAutoSellByLink: state.autoSell }));

describe("lose-order execution dependency assembly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.calls.length = 0;
    state.active.runs.clear();
    state.user.extensionPrefs.arbFailAutoSell.enabled = false;
  });

  it("passes the original live stores and context in the same acquisition order", async () => {
    const ctx = { setMessage: vi.fn() };
    await processLoseOrders(ctx);
    expect(state.calls).toEqual(["user", "match", "account", "queue"]);
    expect(runLoseOrderExecution).toHaveBeenCalledExactlyOnceWith(ctx, expect.objectContaining({
      user: state.user, matchStore: state.match, accountStore: state.account, loseStore: state.queue,
      passesMakeUpAccount: state.filter, syncActiveBetMakeupAttempt: state.sync,
    }));
  });

  it("reads the latest non-skipped progress leg only when execution requests it", async () => {
    await processLoseOrders({ setMessage: vi.fn() });
    expect(state.calls).not.toContain("active");
    const deps = vi.mocked(runLoseOrderExecution).mock.calls[0]![1];
    state.active.runs.set(100, { legs: [
      { side: "A", target: "Home", status: "skipped" },
      { side: "B", target: "Home", status: "makeup" },
    ] });
    expect(deps.getMakeupSide(100, "Home")).toBe("B");
    expect(state.calls.at(-1)).toBe("active");
    state.active.runs.delete(100);
    expect(deps.getMakeupSide(100, "Home")).toBeUndefined();
  });

  it("rechecks the auto-sell switch at the actual abandon callback", async () => {
    const ctx = { setMessage: vi.fn() };
    await processLoseOrders(ctx);
    const deps = vi.mocked(runLoseOrderExecution).mock.calls[0]![1];
    deps.scheduleArbFailAutoSellByLink(10, ctx.setMessage, "test");
    expect(state.autoSell).not.toHaveBeenCalled();
    state.user.extensionPrefs.arbFailAutoSell.enabled = true;
    deps.scheduleArbFailAutoSellByLink(10, ctx.setMessage, "test");
    await vi.waitFor(() => expect(state.autoSell).toHaveBeenCalledExactlyOnceWith({
      linkId: 10, setMessage: ctx.setMessage, reason: "test",
    }));
    state.user.extensionPrefs.arbFailAutoSell.enabled = false;
    deps.scheduleArbFailAutoSellByLink(10, ctx.setMessage, "test");
    expect(state.autoSell).toHaveBeenCalledTimes(1);
  });
});

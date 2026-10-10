import type { BetOption } from "@changmen/client-core/models/betOption";
import type { GtcCommand, GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import { BetResult } from "@changmen/client-core/models/betResult";
import { applyGtcCommand, createGtcExecution } from "@changmen/shared/pm_gtc";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeManualGtc } from "./manual";

const notices = vi.hoisted(() => ({ notify: vi.fn(), close: vi.fn() }));

const mocks = vi.hoisted(() => ({ check: vi.fn(), prepare: vi.fn(), submit: vi.fn(), validate: vi.fn(), create: vi.fn(), refresh: vi.fn(), save: vi.fn(), balance: vi.fn(), valid: true, row: undefined as GtcExecution | undefined, progress: { ready: true, records: [] as GtcExecution[] }, user: { isLoggedIn: true, userId: "owner", extensionPrefs: { pmGtcV1Participant: false, pmArbOrderMode: "FOK" }, config: { betting: false } } }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => 1, isAuthSessionCurrent: () => mocks.valid }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ ...mocks.user, saveExtensionPrefs: mocks.save }) }));
vi.mock("./gateway", () => ({ checkBetting: mocks.check }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ refreshOrderListAfterBind: vi.fn() }));
vi.mock("element-plus", () => ({ ElNotification: notices.notify }));
vi.mock("@changmen/venue-adapter/polymarket/gtc", () => ({ prepareManualGtcBuy: mocks.prepare, pmSubmitMaker: () => "maker" }));
vi.mock("./api", () => ({ createGtc: mocks.create }));
vi.mock("./runtime", () => ({ gtcProgress: mocks.progress, startGtcRuntime: vi.fn(), refreshGtcRecords: mocks.refresh, acceptGtc: (row: GtcExecution) => { mocks.row = row; return row; }, currentGtc: () => mocks.row, mutateGtc: async (_id: string, command: GtcCommand) => { mocks.row = applyGtcCommand(mocks.row!, command, Date.now()); return mocks.row; }, pollGtc: async () => {
  const row = mocks.row!; if (row.submit === "accepted")
    mocks.row = applyGtcCommand(row, { kind: "facts", facts: { order: { id: row.orderId!, original: "10", matched: "0", status: "LIVE", tradeIds: [] }, fills: [], complete: true, observedAt: Date.now() } }, Date.now()); return mocks.row;
} }));
const hash = `0x${"a".repeat(64)}`;
const account = { accountId: 1, provider: "Polymarket", currency: "USDT" } as never;
const input = () => ({ type: "Polymarket", betId: "condition", itemId: "token", target: "Home", betMoney: 50, odds: 2 } as BetOption);
const context = () => ({ match: { id: 1, title: "A vs B" } as never, bet: { id: 2, homeName: "A", awayName: "B", getBetName: () => "全场" } as never, setMessage: vi.fn() });
beforeEach(() => {
  vi.clearAllMocks(); mocks.valid = true; mocks.row = undefined; mocks.progress.ready = true; mocks.progress.records = [];
  notices.notify.mockReturnValue({ close: notices.close });
  mocks.user.extensionPrefs = { pmGtcV1Participant: false, pmArbOrderMode: "FOK" };
  mocks.check.mockImplementation(async (_account, option) => { option.betMoney = 5; option.stakeExchange = 6.7; option.data = {}; return option; });
  mocks.prepare.mockResolvedValue({ shares: "10", targetShares: "10", price: "0.5", maxPrincipal: "5", allInBudget: "5", feeProof: { rate: "0", exponent: 1, takerOnly: true, observedAt: 1 }, protocol: 2, negRisk: false, orderHash: hash, route: "direct", submit: mocks.submit, validate: mocks.validate });
  mocks.submit.mockResolvedValue({ success: true, orderID: hash, status: "live" });
  mocks.create.mockImplementation(async (id: string, maker: string, plan: GtcPlan) => createGtcExecution(id, "owner", "wallet", maker, plan, Date.now()));
  mocks.save.mockResolvedValue(undefined); mocks.refresh.mockResolvedValue(undefined); mocks.balance.mockResolvedValue(undefined);
  vi.spyOn(BetResult.prototype, "saveLog").mockImplementation(() => {});
});

describe("isolated manual GTC execution", () => {
  it("old recovery unavailable does not block a newly persisted manual order", async () => {
    mocks.progress.ready = false; mocks.refresh.mockRejectedValue(new Error("old list unavailable"));
    await executeManualGtc(account, input(), context());
    expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it("submits exactly once with automatic betting off and persists manual source", async () => {
    const ctx = context(); const result = await executeManualGtc(account, input(), ctx);
    expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.check).toHaveBeenCalledWith(account, expect.anything(), { skipAccountRate: true, manual: true });
    expect(mocks.create.mock.calls[0]?.[2]).toMatchObject({ source: "manual", otherPlayerId: 0, otherProvider: "", otherStake: 0, item: "A" });
    expect(mocks.row).toMatchObject({ submit: "accepted", matched: "0", open: "10", decision: "closed", other: { state: "not_attempted" } });
    expect(result).toMatchObject({ source: "manual", pm: { orderType: "GTC", submission: "accepted", fill: "none", remainingShares: "10" }, other: null });
    expect(ctx.setMessage).not.toHaveBeenCalled();
    expect(notices.notify).toHaveBeenNthCalledWith(1, expect.objectContaining({ position: "top-right", customClass: "notification loading Polymarket", message: expect.stringContaining("金额：5@2") }));
    expect(notices.close).toHaveBeenCalledOnce();
    expect(notices.notify).toHaveBeenNthCalledWith(2, expect.objectContaining({ position: "top-right", type: "warning", duration: 10_000, message: expect.stringContaining("未成交挂单中") }));
  });
  it("enables persistence recovery without switching automatic FOK preference", async () => {
    await executeManualGtc(account, input(), context()); expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.user.extensionPrefs).toMatchObject({ pmGtcV1Participant: true, pmArbOrderMode: "FOK" });
    expect(mocks.create.mock.calls[0]?.[2]).not.toHaveProperty("submit");
    expect(mocks.create.mock.calls[0]?.[2]).not.toHaveProperty("validate");
  });
  it("failure to persist this new execution blocks before POST", async () => {
    mocks.create.mockRejectedValueOnce(new Error("backend unavailable"));
    await expect(executeManualGtc(account, input(), context())).rejects.toThrow("backend unavailable");
    expect(mocks.check).toHaveBeenCalledOnce(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each(["prepared", "accepted", "unknown"] as const)("existing %s execution does not block a new manual order", async (submit) => {
    const old = { id: "old", released: false, maker: "maker", submit, orderId: submit === "accepted" ? "old-order" : null } as GtcExecution;
    mocks.progress.records = [old];
    const result = await executeManualGtc(account, input(), context());
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ source: "manual", pm: { submission: "accepted" } });
    expect(result.executionId).not.toBe(old.id);
    expect(mocks.progress.records).toEqual([old]);
  });
  it("successive manual orders each create a new execution and submit once", async () => {
    await executeManualGtc(account, input(), context());
    const first = mocks.row!;
    mocks.progress.records = [first];
    await executeManualGtc(account, input(), context());
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.row!.id).not.toBe(first.id);
    expect(first).toMatchObject({ submit: "accepted", orderId: hash, open: "10", released: false });
  });
  it("unknown POST remains original-only and never resends", async () => {
    mocks.submit.mockRejectedValueOnce(new Error("timeout")); await executeManualGtc(account, input(), context());
    expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.row).toMatchObject({ submit: "unknown", released: false, decision: "closed" });
    expect(notices.notify).toHaveBeenLastCalledWith(expect.objectContaining({ type: "warning", message: expect.stringContaining("timeout") }));
  });
  it("definitive rejection is not reported as successful placement or left holding the wallet", async () => {
    mocks.submit.mockResolvedValueOnce({ success: false, errorMsg: "market closed" });
    await executeManualGtc(account, input(), context());
    expect(mocks.row).toMatchObject({ submit: "rejected", released: true, error: "market closed" });
    expect(notices.notify).toHaveBeenLastCalledWith(expect.objectContaining({ type: "error", message: expect.stringContaining("market closed") }));
  });
  it("session change after reservation prevents POST", async () => {
    mocks.create.mockImplementationOnce(async (id: string, maker: string, plan: GtcPlan) => { mocks.valid = false; return createGtcExecution(id, "owner", "wallet", maker, plan, Date.now()); });
    await expect(executeManualGtc(account, input(), context())).rejects.toThrow("会话已变更"); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("failed manual precheck never signs or posts", async () => {
    mocks.check.mockImplementationOnce(async (_account, option) => { option.data = null; option.checkError = "market closed"; return option; });
    await expect(executeManualGtc(account, input(), context())).rejects.toThrow("market closed");
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
    expect(notices.notify).not.toHaveBeenCalled();
  });
});

import type { BetOption } from "@changmen/client-core/models/betOption";
import type { GtcOrderPlan } from "@changmen/shared/pm_gtc_order";
import type { GtcOrderRecord, GtcOrderContext, GtcOrderCommand } from "./core/orderRecord";
import { applyGtcOrderCommand, createGtcOrderRecord } from "./core/orderRecord";
import { BetResult } from "@changmen/client-core/models/betResult";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeManualGtc } from "./manual";
import * as pmOrders from "@changmen/venue-browser/polymarket/orders/history/orders";

const notices = vi.hoisted(() => ({ notify: vi.fn(), close: vi.fn() }));
const mocks = vi.hoisted(() => ({ check: vi.fn(), prepare: vi.fn(), submit: vi.fn(), validate: vi.fn(), create: vi.fn(), save: vi.fn(),
  valid: true, row: undefined as GtcOrderRecord | undefined,
  progress: { owner: "owner", ready: true, records: [] as GtcOrderRecord[] },
  user: { isLoggedIn: true, userId: "owner", extensionPrefs: { pmGtcV1Participant: false, pmArbOrderMode: "FOK" }, config: { betting: false } } }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => 1, isAuthSessionCurrent: () => mocks.valid }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ ...mocks.user, saveExtensionPrefs: mocks.save }) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ findAccount: () => ({ accountId: 1, provider: "Polymarket" }) }) }));
vi.mock("./gateway", () => ({ checkBetting: mocks.check }));
vi.mock("@/stores/betting/arbOrderBind", () => ({ refreshOrderListAfterBind: vi.fn() }));
vi.mock("element-plus", () => ({ ElNotification: notices.notify }));
vi.mock("@changmen/venue-browser/polymarket/gtc/index", () => ({ prepareManualGtcBuy: mocks.prepare, pmSubmitMaker: () => `0x${"a".repeat(40)}` }));
vi.mock("./orderState", () => ({ gtcOrders: mocks.progress }));
vi.mock("./orderRuntime", () => ({ startNativeGtcOrders: vi.fn(),
  createGtcOrder: async (...args: unknown[]) => { mocks.row = await mocks.create(...args); return mocks.row; },
  currentGtcOrder: () => mocks.row,
  changeGtcOrder: async (_id: string, command: GtcOrderCommand) => { mocks.row = applyGtcOrderCommand(mocks.row!, command); return mocks.row; },
  closeGtcOrderSubmission: async () => { mocks.row = applyGtcOrderCommand(mocks.row!, { kind: "close" }); },
  cancelNativeGtcOrder: vi.fn(),
  pollGtcOrder: async () => {
    const row = mocks.row!;
    if (row.submit === "accepted") mocks.row = applyGtcOrderCommand(row, { kind: "facts", facts: {
      order: { id: row.orderId!, original: "10", matched: "0", status: "LIVE", tradeIds: [] }, fills: [], complete: true, observedAt: Date.now() } });
    return mocks.row;
  },
}));
const hash = `0x${"a".repeat(64)}`;
const account = { accountId: 1, provider: "Polymarket", currency: "USDT" } as never;
const input = () => ({ type: "Polymarket", betId: "condition", itemId: "token", target: "Home", betMoney: 50, odds: 2 } as BetOption);
const context = () => ({ match: { id: 1, title: "A vs B" } as never, bet: { id: 2, homeName: "A", awayName: "B", getBetName: () => "全场" } as never, setMessage: vi.fn() });
beforeEach(() => {
  vi.clearAllMocks(); mocks.valid = true; mocks.row = undefined; mocks.progress.ready = true; mocks.progress.records = [];
  notices.notify.mockReturnValue({ close: notices.close });
  mocks.user.extensionPrefs = { pmGtcV1Participant: false, pmArbOrderMode: "FOK" };
  mocks.check.mockImplementation(async (_account, option) => { option.betMoney = 5; option.stakeExchange = 6.7; option.data = {}; return option; });
  mocks.prepare.mockResolvedValue({ shares: "10", targetShares: "10", price: "0.5", maxPrincipal: "5", allInBudget: "5", protocol: 2, negRisk: false, orderHash: hash, route: "direct", submit: mocks.submit, prepareSubmit: async () => { mocks.validate(); }, validate: mocks.validate });
  mocks.submit.mockResolvedValue({ success: true, orderID: hash, status: "live" });
  mocks.create.mockImplementation(async (id: string, accountId: number, maker: string, plan: GtcOrderPlan, ctx: GtcOrderContext) => createGtcOrderRecord(id, "owner", accountId, maker, plan, ctx, Date.now()));
  mocks.save.mockResolvedValue(undefined);
  vi.spyOn(BetResult.prototype, "saveLog").mockImplementation(() => {});
});
describe("manual GTC uses a single-order record", () => {
  it("keeps explicit unsent distinct from a dispatched unknown order", async () => {
    mocks.submit.mockResolvedValueOnce({ success: false, pmSubmitNotSent: true, errorMsg: "pre-dispatch failed" });
    const result = await executeManualGtc(account, input(), context());
    expect(result).toMatchObject({ submit: "not_attempted", orderId: null, pmAuthorized: true, submitNotSent: true, submissionClosed: true });
  });
  it("saves the native PM label for a manual bet launched from a decider row", async () => {
    const label = vi.spyOn(pmOrders, "lookupPolymarketOrderBetLabel").mockReturnValueOnce("全场");
    const ctx = context(); ctx.bet = { id: 2, homeName: "A", awayName: "B", getBetName: () => "[地图3] 获胜" } as never;
    await executeManualGtc(account, input(), ctx);
    expect(label).toHaveBeenCalledWith("condition", "token"); expect(mocks.create.mock.calls[0]![4]).toMatchObject({ bet: "全场" }); label.mockRestore();
  });
  it("old recovery unavailable does not block a newly persisted manual order", async () => {
    mocks.progress.ready = false;
    await executeManualGtc(account, input(), context()); expect(mocks.create).toHaveBeenCalledOnce(); expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it("submits exactly once with automatic betting off and has no fake opposite leg", async () => {
    const ctx = context(); const result = await executeManualGtc(account, input(), ctx);
    expect(mocks.submit).toHaveBeenCalledOnce(); expect(mocks.check).toHaveBeenCalledWith(account, expect.anything(), { skipAccountRate: true, manual: true });
    expect(result).toMatchObject({ formatVersion: 2, orderType: "GTC", submit: "accepted", matched: "0", open: "10", submissionClosed: true, context: { item: "A" } });
    expect(result).not.toHaveProperty("other"); expect(result.plan).not.toHaveProperty("otherPlayerId"); expect(result.plan).not.toHaveProperty("source");
    expect(ctx.setMessage).not.toHaveBeenCalled(); expect(notices.close).toHaveBeenCalledOnce();
    expect(notices.notify).toHaveBeenNthCalledWith(1, expect.objectContaining({ position: "top-right", customClass: "notification loading Polymarket", message: expect.stringContaining("金额：5@2") }));
    expect(notices.notify).toHaveBeenNthCalledWith(2, expect.objectContaining({ position: "top-right", type: "warning", duration: 10_000, message: expect.stringContaining("未成交挂单中") }));
  });
  it("keeps FOK preferences unchanged and never persists functions or credential fields", async () => {
    await executeManualGtc(account, input(), context()); expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.user.extensionPrefs).toMatchObject({ pmGtcV1Participant: true, pmArbOrderMode: "FOK" });
    expect(mocks.row!.plan).not.toHaveProperty("submit"); expect(mocks.row!.plan).not.toHaveProperty("validate");
  });
  it("failure to persist this new order blocks before POST", async () => {
    mocks.create.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(executeManualGtc(account, input(), context())).rejects.toThrow("storage unavailable"); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it.each(["prepared", "accepted", "unknown"] as const)("existing %s order does not block a new manual order", async submit => {
    const old = { id: "old", submit } as GtcOrderRecord; mocks.progress.records = [old];
    const result = await executeManualGtc(account, input(), context()); expect(result.submit).toBe("accepted"); expect(result.id).not.toBe(old.id); expect(mocks.progress.records).toEqual([old]);
  });
  it("successive manual orders each create a new identity and submit once", async () => {
    const first = await executeManualGtc(account, input(), context());
    mocks.progress.records = [first]; const second = await executeManualGtc(account, input(), context());
    expect(mocks.submit).toHaveBeenCalledTimes(2); expect(second.id).not.toBe(first.id); expect(first).toMatchObject({ submit: "accepted", orderId: hash, open: "10" });
  });
  it("unknown POST remains original-only and never resends", async () => {
    mocks.submit.mockRejectedValueOnce(new Error("timeout"));
    expect(await executeManualGtc(account, input(), context())).toMatchObject({ submit: "unknown", submissionClosed: true });
    expect(mocks.submit).toHaveBeenCalledOnce(); expect(notices.notify).toHaveBeenLastCalledWith(expect.objectContaining({ type: "warning", message: expect.stringContaining("timeout") }));
  });
  it("definitive rejection is reported as failure", async () => {
    mocks.submit.mockResolvedValueOnce({ success: false, errorMsg: "market closed" });
    expect(await executeManualGtc(account, input(), context())).toMatchObject({ submit: "rejected", terminal: true, complete: true, open: "0" });
    expect(notices.notify).toHaveBeenLastCalledWith(expect.objectContaining({ type: "error", message: expect.stringContaining("market closed") }));
  });
  it("session change after reservation prevents POST", async () => {
    mocks.create.mockImplementationOnce(async (id: string, accountId: number, maker: string, plan: GtcOrderPlan, ctx: GtcOrderContext) => {
      mocks.valid = false; return createGtcOrderRecord(id, "owner", accountId, maker, plan, ctx, Date.now());
    });
    await expect(executeManualGtc(account, input(), context())).rejects.toThrow("会话已变更"); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("failed manual precheck never signs or posts", async () => {
    mocks.check.mockImplementationOnce(async (_account, option) => { option.data = null; option.checkError = "market closed"; return option; });
    await expect(executeManualGtc(account, input(), context())).rejects.toThrow("market closed"); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled(); expect(notices.notify).not.toHaveBeenCalled();
  });
});

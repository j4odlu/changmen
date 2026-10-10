import type { GtcCommand, GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import { applyGtcCommand, createGtcExecution } from "@changmen/shared/pm_gtc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gtcOrderProjection } from "@/orderModes/gtc/executionProjection";
import { cancelGtc, currentGtc, gtcProgress, pollGtc, refreshGtcRecords, startGtcRuntime, stopGtcRuntime } from "./runtime";

const mocks = vi.hoisted(() => ({ cancel: vi.fn(), read: vi.fn(), command: vi.fn(), list: vi.fn(), mark: vi.fn(), calls: [] as string[] }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => 1, isAuthSessionCurrent: () => true }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: "owner", extensionPrefs: {} }) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ findAccount: () => ({ provider: "Polymarket", accountId: 1 }) }) }));
vi.mock("@/stores/betting/successMarkers", () => ({ markSuccessfulBet: mocks.mark }));
vi.mock("./successMarkers", () => ({ markGtcSuccess: mocks.mark }));
vi.mock("./api", () => ({ listGtc: mocks.list, commandGtc: mocks.command }));
vi.mock("./ordersApi", () => ({ refreshGtcOrders: vi.fn().mockResolvedValue(undefined), saveOrders: vi.fn() }));
vi.mock("@changmen/venue-adapter/polymarket/gtc", () => ({ readGtcFacts: mocks.read, pmCancelOrder: mocks.cancel }));
const hash = `0x${"a".repeat(64)}`;
const plan = { playerId: 1, otherPlayerId: 2, shares: "10", tokenId: "token", orderHash: hash, betRowId: 2, target: "Home", otherTarget: "Away", otherOdds: 2, originalPmLeg: "A" } as GtcPlan;
function row() {
  const initial = createGtcExecution("id", "owner", "wallet", "maker", plan, Date.now());
  return applyGtcCommand(applyGtcCommand(initial, { kind: "authorize_pm" }, Date.now()), { kind: "ack", state: "accepted", orderId: hash }, Date.now());
}
const facts = () => ({ order: { id: hash, original: "10", matched: "0", status: "LIVE", tradeIds: [] }, fills: [], complete: true, observedAt: Date.now() });
beforeEach(() => {
  stopGtcRuntime(); vi.clearAllMocks(); sessionStorage.clear(); mocks.calls = [];
  gtcProgress.owner = "owner"; gtcProgress.records = [row()];
  mocks.command.mockImplementation(async (previous: GtcExecution, command: GtcCommand) => {
    mocks.calls.push(command.kind); return applyGtcCommand(JSON.parse(JSON.stringify(previous)), command, Date.now());
  });
  mocks.read.mockResolvedValue(facts()); mocks.cancel.mockResolvedValue({ canceled: [hash] }); mocks.list.mockResolvedValue([row()]);
});
afterEach(() => stopGtcRuntime());
describe("gTC independent progress and cancellation", () => {
  it("starting recovery preserves financial rows already loaded for this owner", async () => {
    stopGtcRuntime();
    const rows = [{ OrderID: "original", PmGtcExecutionId: "id" }];
    gtcOrderProjection.owner = "owner"; gtcOrderProjection.rows = rows;
    startGtcRuntime("owner");
    await vi.waitFor(() => expect(gtcProgress.ready).toBe(true));
    expect(gtcOrderProjection.rows).toEqual(rows);
  });
  it("switching runtime owner clears the former owner's financial rows", () => {
    gtcOrderProjection.owner = "foreign"; gtcOrderProjection.rows = [{ OrderID: "foreign", PmGtcExecutionId: "g" }];
    startGtcRuntime("next-owner");
    expect(gtcOrderProjection.rows).toEqual([]);
  });
  function legacyUnsubmitted() {
    const record = createGtcExecution("legacy", "owner", "wallet", "maker", plan, Date.now());
    record.submit = "rejected"; record.decision = "closed"; record.manual = true; record.terminal = true; record.complete = true; record.open = "0";
    record.other = { state: "rejected", orderId: null, submittedAt: Date.now(), message: "赔率下降至1.84" };
    return record;
  }
  it("periodic recovery closes legacy empty executions without any venue dispatch or query", async () => {
    stopGtcRuntime(); mocks.list.mockResolvedValue([legacyUnsubmitted()]); startGtcRuntime("owner");
    await vi.waitFor(() => expect(gtcProgress.records[0]?.released).toBe(true));
    expect(currentGtc("legacy").submit).toBe("not_attempted"); expect(mocks.calls).toEqual(["close"]);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled(); expect(mocks.mark).not.toHaveBeenCalled();
  });
  it("recovery preserves an unknown other leg even when PM was never submitted", async () => {
    stopGtcRuntime(); const record = legacyUnsubmitted(); record.other.state = "unknown";
    mocks.list.mockResolvedValue([record]); startGtcRuntime("owner");
    await vi.waitFor(() => expect(gtcProgress.ready).toBe(true));
    expect(currentGtc("legacy").released).toBe(false); expect(mocks.command).not.toHaveBeenCalled();
  });
  it("durably takes over original group before cancellation HTTP", async () => {
    mocks.cancel.mockImplementation(async () => { expect(currentGtc("id").manual).toBe(true); expect(currentGtc("id").decision).toBe("closed"); mocks.calls.push("HTTP_CANCEL"); return { canceled: [hash] }; });
    await cancelGtc("id"); expect(mocks.calls.indexOf("cancel")).toBeLessThan(mocks.calls.indexOf("HTTP_CANCEL"));
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(expect.anything(), hash); expect(currentGtc("id").open).toBe("10"); expect(currentGtc("id").released).toBe(false);
  });
  it("failed durable cancellation intent prevents venue HTTP", async () => {
    mocks.command.mockRejectedValueOnce(new Error("database lost")); await expect(cancelGtc("id")).rejects.toThrow("database lost"); expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("cancel timeout remains manual and does not resend a BUY", async () => {
    mocks.cancel.mockRejectedValueOnce(new Error("timeout")); await cancelGtc("id");
    expect(currentGtc("id")).toMatchObject({ manual: true, decision: "closed", released: false }); expect(currentGtc("id").cancel?.state).toBe("unknown");
    expect(mocks.calls).not.toContain("authorize_pm"); expect(mocks.calls).not.toContain("authorize_other");
  });
  it("concurrent UI/WS polling reads original only once", async () => {
    await Promise.all([pollGtc("id"), pollGtc("id")]); expect(mocks.read).toHaveBeenCalledOnce(); expect(mocks.mark).not.toHaveBeenCalled();
  });
  it("query failure preserves accepted identity and makes remaining quantity unknown", async () => {
    mocks.read.mockRejectedValue(new Error("read failed")); await pollGtc("id"); expect(currentGtc("id").submit).toBe("accepted"); expect(currentGtc("id").complete).toBe(false); expect(currentGtc("id").error).toBe("read failed");
  });
  it("first positive fill restores each local session count once", async () => {
    mocks.read.mockResolvedValue({ ...facts(), order: { ...facts().order, matched: "5", tradeIds: ["trade"] }, fills: [{ key: "trade:maker", tradeId: "trade", bucket: "maker", role: "MAKER", shares: "5", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: Date.now() }] });
    await pollGtc("id"); await pollGtc("id"); expect(mocks.mark).toHaveBeenCalledOnce(); expect(currentGtc("id").counted).toBe(true);
  });
  it("restoring an execution only loads evidence and never grants automatic dispatch", async () => {
    await refreshGtcRecords(); expect(gtcProgress.ready).toBe(true); expect(mocks.command).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
  });
});

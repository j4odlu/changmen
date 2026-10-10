import type { GtcCommand, GtcExecution, GtcPlan } from "@changmen/shared/pm_gtc";
import { applyGtcCommand, createGtcExecution } from "@changmen/shared/pm_gtc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { getLastBetOdds, passesLastOddsGate, passesMaxBetCount, readBetCount } from "@/shared/betTiming";
import { markSuccessfulBet, readUsedAccounts } from "@/stores/betting/successMarkers";
import { gtcProgress, markGtcLegOnce, pollGtc, refreshGtcRecords, stopGtcRuntime } from "./runtime";
import { assertGtcHistoryAllowsLeg, markGtcSuccess, readGtcBetCount, readGtcLastOdds, readGtcUsedAccounts } from "./successMarkers";

const mocks = vi.hoisted(() => ({ owner: "owner", mode: "FOK", list: vi.fn(), command: vi.fn(), read: vi.fn(), accounts: [] as PlatformAccount[] }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => 1, isAuthSessionCurrent: () => true }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: mocks.owner, extensionPrefs: { pmArbOrderMode: mocks.mode, pmGtcV1Participant: true } }) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ findAccount: (id: number) => mocks.accounts.find(account => account.accountId === id) }) }));
vi.mock("./api", () => ({ listGtc: mocks.list, commandGtc: mocks.command }));
vi.mock("@changmen/venue-adapter/polymarket/gtc", () => ({ readGtcFacts: mocks.read }));

const betId = 99001;
const hash = `0x${"a".repeat(64)}`;
function execution(source?: "manual"): GtcExecution {
  const plan = { source, playerId: 901, otherPlayerId: 902, shares: "10", tokenId: "token", orderHash: hash, betRowId: betId, target: "Home", otherTarget: "Away", otherOdds: 2, originalPmLeg: "A" } as GtcPlan;
  const row = createGtcExecution("old-gtc", "owner", "wallet", "maker", plan, Date.now());
  row.complete = true; row.matched = "5"; row.principal = "2.5"; row.fee = "0";
  row.other = { state: "filled", orderId: "ray-order", submittedAt: Date.now(), message: "" };
  return row;
}

function fokState() {
  return mocks.accounts.map((account, index) => {
    const side = index === 0 ? "Home" : "Away";
    return { count: readBetCount(account.accountId, betId, side), lastOdds: getLastBetOdds(account.accountId, betId, side), used: readUsedAccounts(betId, side), countPasses: passesMaxBetCount(account, betId, side), oddsPasses: passesLastOddsGate(account, betId, side, 1.8) };
  });
}

beforeEach(() => {
  stopGtcRuntime(); vi.clearAllMocks(); sessionStorage.clear();
  mocks.owner = "owner"; mocks.mode = "FOK";
  mocks.accounts = [new PlatformAccount({ accountId: 901, provider: "Polymarket", playerName: "PM", maxBetCount: 2, lastOdds: true }), new PlatformAccount({ accountId: 902, provider: "RAY", playerName: "RAY", maxBetCount: 2, lastOdds: true })];
  markSuccessfulBet(mocks.accounts[0]!, betId, "Home", 1.4);
  markSuccessfulBet(mocks.accounts[1]!, betId, "Away", 1.4);
  gtcProgress.owner = "owner";
  mocks.command.mockImplementation(async (row: GtcExecution, command: GtcCommand) => applyGtcCommand(JSON.parse(JSON.stringify(row)), command, Date.now()));
});
afterEach(() => stopGtcRuntime());

describe("gTC history never changes FOK filters", () => {
  it.each(["FOK", "GTC"])("isolates both legs and duplicate facts while current mode is %s", (mode) => {
    mocks.mode = mode;
    const before = fokState(); const row = execution();
    for (let n = 0; n < 3; n++) {
      markGtcLegOnce(row, "PM"); markGtcLegOnce(row, "OTHER");
    }
    expect(fokState()).toEqual(before);
    expect(before.every(state => state.countPasses && state.oddsPasses)).toBe(true);
    expect(readGtcBetCount("owner", 901, betId, "Home")).toBe(1);
    expect(readGtcBetCount("owner", 902, betId, "Away")).toBe(1);
    expect(readGtcLastOdds("owner", 901, betId, "Home")).toBe(2);
    expect(readGtcUsedAccounts("owner", betId, "Away")).toEqual([902]);
  });

  it("manual GTC fills leave existing FOK history intact", () => {
    const before = fokState(); markGtcLegOnce(execution("manual"), "PM");
    expect(fokState()).toEqual(before);
    expect(readGtcBetCount("owner", 901, betId, "Home")).toBe(1);
  });

  it("a later confirmed fill is isolated after switching back to FOK", async () => {
    let row = createGtcExecution("old-gtc", "owner", "wallet", "maker", execution().plan, Date.now());
    row = applyGtcCommand(row, { kind: "authorize_pm" }, Date.now());
    row = applyGtcCommand(row, { kind: "ack", state: "accepted", orderId: hash }, Date.now());
    gtcProgress.records = [row]; const before = fokState();
    mocks.read.mockResolvedValue({ order: { id: hash, original: "10", matched: "5", status: "LIVE", tradeIds: ["trade"] }, fills: [{ key: "trade:maker", tradeId: "trade", bucket: "maker", role: "MAKER", shares: "5", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: Date.now() }], complete: true, observedAt: Date.now() });
    await pollGtc(row.id); await pollGtc(row.id);
    expect(fokState()).toEqual(before);
    expect(readGtcBetCount("owner", 901, betId, "Home")).toBe(1);
    expect(gtcProgress.records[0]!.counted).toBe(true);
  });

  it("recovery rebuilds only GTC history even when a legacy V1 dedupe key exists", async () => {
    const before = fokState(); const row = execution();
    sessionStorage.setItem(`PM_GTC_V1_COUNT:${row.owner}:${row.id}:PM`, "1");
    mocks.list.mockResolvedValue([row]);
    await refreshGtcRecords(); await refreshGtcRecords();
    expect(fokState()).toEqual(before);
    expect(readGtcBetCount("owner", 901, betId, "Home")).toBe(1);
    expect(readGtcBetCount("owner", 902, betId, "Away")).toBe(1);
  });

  it("unconfirmed or zero PM fills and pending other orders never count", () => {
    const row = execution(); row.complete = false; row.other.state = "pending";
    markGtcLegOnce(row, "PM"); markGtcLegOnce(row, "OTHER");
    row.complete = true; row.matched = "0"; markGtcLegOnce(row, "PM");
    expect(readGtcBetCount("owner", 901, betId, "Home")).toBe(0);
    expect(readGtcBetCount("owner", 902, betId, "Away")).toBe(0);
  });

  it("a foreign owner cannot write history through the current user's account", () => {
    const before = fokState(); const row = execution(); row.owner = "foreign";
    markGtcLegOnce(row, "PM"); markGtcLegOnce(row, "OTHER");
    expect(fokState()).toEqual(before);
    expect(readGtcBetCount("foreign", 901, betId, "Home")).toBe(0);
  });

  it("gTC limits remain enforced using only its own history", () => {
    const account = mocks.accounts[0]!;
    account.maxBetCount = 1;
    expect(() => assertGtcHistoryAllowsLeg("owner", account, betId, "Home", 1.2, false)).not.toThrow();
    markGtcSuccess("owner", account.accountId, betId, "Home", 2);
    expect(() => assertGtcHistoryAllowsLeg("owner", account, betId, "Home", 3, false)).toThrow("订单上限");
    account.maxBetCount = 0;
    expect(() => assertGtcHistoryAllowsLeg("owner", account, betId, "Home", 1.8, false)).toThrow("赔率");
    expect(() => assertGtcHistoryAllowsLeg("owner", account, betId, "Away", 3, true)).toThrow("反向");
    expect(() => assertGtcHistoryAllowsLeg("another-owner", account, betId, "Home", 1.2, true)).not.toThrow();
  });
  it("history on unrelated markets or accounts never limits a new bet even on the same wallet", () => {
    const account = mocks.accounts[0]!; account.maxBetCount = 1;
    markGtcSuccess("owner", account.accountId, betId + 1, "Home", 100);
    markGtcSuccess("owner", account.accountId, betId + 1, "Away", 100);
    markGtcSuccess("owner", 999, betId, "Home", 100);
    markGtcSuccess("owner", 999, betId, "Away", 100);
    expect(() => assertGtcHistoryAllowsLeg("owner", account, betId, "Home", 1.2, true)).not.toThrow();
  });
});

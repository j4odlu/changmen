import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlePmGtc } from "./handler.js";

const mocks = vi.hoisted(() => ({ sync: vi.fn(), read: vi.fn(), create: vi.fn(), list: vi.fn(), import: vi.fn(), command: vi.fn(), owned: vi.fn(), accounts: vi.fn() }));
vi.mock("@changmen/db", () => ({ createPmGtc: mocks.create, listPmGtc: mocks.list, listPmGtcClientImport: mocks.import, mutatePmGtc: mocks.command }));
vi.mock("../../account/player_ownership.js", () => ({ assertPlayerOwnedByUser: mocks.owned }));
vi.mock("../../db/store.js", () => ({ refreshAccountsFromRdsIfEmpty: vi.fn() }));
vi.mock("../../esport-api/store.js", () => ({ default: { getAccountsForUser: mocks.accounts } }));
const maker = `0x${"a".repeat(40)}`;
const plan = { playerId: 1, otherPlayerId: 2, originalPmLeg: "A", otherProvider: "RAY", otherTarget: "Away", otherOdds: 2, otherStake: 10, target: "Home", protocol: 2, orderHash: `0x${"b".repeat(64)}`, price: "0.5", shares: "10", targetShares: "10", maxPrincipal: "5", allInBudget: "5", fx: 6.7, parallel: false, negRisk: false, feeProof: { rate: "0", exponent: 1, takerOnly: true, observedAt: 1 } };
const body = () => ({ id: "11111111-1111-4111-8111-111111111111", maker, plan });
beforeEach(() => {
  vi.clearAllMocks(); mocks.owned.mockResolvedValue({ ok: true }); mocks.accounts.mockReturnValue([
    { accountId: 1, provider: "Polymarket", token: JSON.stringify({ funder: maker, apiKey: "secret" }) },
    { accountId: 2, provider: "RAY" },
  ]);
});
vi.mock("./results.js", () => ({ syncGtcConfirmedResult: mocks.sync, readGtcConfirmedResults: mocks.read, saveClientGtcOrders: vi.fn() }));
describe("GTC client control and read-only legacy recovery", () => {
  it.each(["Pm_GtcCreate", "Pm_GtcCommand"])("retires %s without writing RDS execution state", async action => {
    await expect(handlePmGtc(action, body(), "owner")).rejects.toThrow("已迁移至客户端");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.command).not.toHaveBeenCalled();
    expect(mocks.owned).not.toHaveBeenCalled();
  });
  it.each(["Pm_GtcList", "Pm_GtcSyncResult", "Pm_GtcReadResults"])("requires authentication for %s", async action => {
    await expect(handlePmGtc(action, {}, null)).rejects.toThrow("登录");
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("imports only the authenticated owner's legacy records", async () => {
    await handlePmGtc("Pm_GtcList", { owner: "foreign" }, "owner");
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith("owner");
  });
  it.each([true, "true"])("client migration %s reads full history with authenticated ownership", async clientImport => {
    await handlePmGtc("Pm_GtcList", { clientImport, owner: "foreign" }, "owner");
    expect(mocks.import).toHaveBeenCalledExactlyOnceWith("owner");
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each([false, "false", "1", "yes"])("does not treat %s as a full-history import request", async clientImport => {
    await handlePmGtc("Pm_GtcList", { clientImport, betRowId: "42" }, "owner");
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith("owner", 42);
    expect(mocks.import).not.toHaveBeenCalled();
  });
  it("keeps legacy scoped and incremental read compatibility", async () => {
    await handlePmGtc("Pm_GtcList", { owner: "foreign", betRowId: 42 }, "owner");
    expect(mocks.list).toHaveBeenCalledWith("owner", 42);
    const knownRevisions = { [body().id]: 3 };
    await handlePmGtc("Pm_GtcList", { knownRevisions: JSON.stringify(knownRevisions) }, "owner");
    expect(mocks.list).toHaveBeenLastCalledWith("owner", undefined, knownRevisions);
  });
  it.each([0, -1, "bad", 1.5])("rejects invalid legacy bet ID %s", async betRowId => {
    await expect(handlePmGtc("Pm_GtcList", { betRowId }, "owner")).rejects.toThrow("盘口 ID");
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it.each(["invalid-json", [], { bad: 1 }, { "11111111-1111-4111-8111-111111111111": -1 }])("rejects invalid legacy versions %o", async knownRevisions => {
    await expect(handlePmGtc("Pm_GtcList", { knownRevisions }, "owner")).rejects.toThrow("已知版本");
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("routes only minimal results and exact anchors with authenticated owner", async () => {
    const body = { owner: "foreign", result: {}, anchors: [] };
    await handlePmGtc("Pm_GtcSyncResult", body, "owner"); await handlePmGtc("Pm_GtcReadResults", body, "owner");
    expect(mocks.sync).toHaveBeenCalledExactlyOnceWith(body, "owner");
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(body, "owner");
    expect(mocks.command).not.toHaveBeenCalled();
  });
});

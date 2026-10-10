import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlePmGtc } from "./handler.js";

const mocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), command: vi.fn(), owned: vi.fn(), accounts: vi.fn() }));
vi.mock("@changmen/db", () => ({ createPmGtc: mocks.create, listPmGtc: mocks.list, mutatePmGtc: mocks.command }));
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
describe("gTC independent coordination handler", () => {
  it("manual source validates only its PM owner and persists no fake second leg", async () => {
    const manual = { ...plan, source: "manual", otherPlayerId: 0, otherProvider: "", otherOdds: 0, otherStake: 0 };
    await handlePmGtc("Pm_GtcCreate", { ...body(), plan: manual }, "owner");
    expect(mocks.owned).toHaveBeenCalledExactlyOnceWith(1, "owner");
    expect(mocks.create.mock.calls[0][0].plan).toMatchObject({ source: "manual", otherPlayerId: 0, otherStake: 0 });
  });
  it("manual marker cannot bypass other-leg validation for an actual pair", async () => {
    await expect(handlePmGtc("Pm_GtcCreate", { ...body(), plan: { ...plan, source: "manual" } }, "owner")).rejects.toThrow("不能包含第二腿");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("unknown source cannot be downgraded into legacy coordination", async () => {
    await expect(handlePmGtc("Pm_GtcCreate", { ...body(), plan: { ...plan, source: "unsupported" } }, "owner")).rejects.toThrow("来源无效");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("blocks unsupported aliases before either venue POST without affecting FOK routes", async () => {
    const accounts = mocks.accounts(); mocks.accounts.mockReturnValue([...accounts, { ...accounts[0], accountId: 3 }]);
    await expect(handlePmGtc("Pm_GtcCreate", body(), "owner")).rejects.toThrow("多个账号别名"); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => { await expect(handlePmGtc("Pm_GtcList", {}, null)).rejects.toThrow("登录"); expect(mocks.list).not.toHaveBeenCalled(); });
  it("lists only authenticated owner", async () => { await handlePmGtc("Pm_GtcList", { owner: "other" }, "owner"); expect(mocks.list).toHaveBeenCalledWith("owner"); });
  it("derives real wallet from owned account and never persists credentials", async () => {
    await handlePmGtc("Pm_GtcCreate", { ...body(), plan: { ...plan, privateKey: "do-not-store", token: "do-not-store" } }, "owner");
    const saved = mocks.create.mock.calls[0][0]; expect(saved.walletKey).toBe(`137:polymarket-collateral:${maker}`);
    expect(saved.plan.privateKey).toBeUndefined(); expect(saved.plan.token).toBeUndefined(); expect(mocks.owned).toHaveBeenCalledTimes(2);
  });
  it("refuses a different client wallet identity", async () => { await expect(handlePmGtc("Pm_GtcCreate", { ...body(), maker: `0x${"c".repeat(40)}` }, "owner")).rejects.toThrow("钱包不一致"); expect(mocks.create).not.toHaveBeenCalled(); });
  it("refuses foreign accounts before reservation", async () => { mocks.owned.mockResolvedValueOnce({ ok: false, msg: "foreign" }); await expect(handlePmGtc("Pm_GtcCreate", body(), "owner")).rejects.toThrow("foreign"); expect(mocks.create).not.toHaveBeenCalled(); });
  it("rejects unknown fee curve before persistence", async () => { await expect(handlePmGtc("Pm_GtcCreate", { ...body(), plan: { ...plan, feeProof: { rate: "0" } } }, "owner")).rejects.toThrow("费用规则"); expect(mocks.create).not.toHaveBeenCalled(); });
  it("commands carry authenticated owner and revision", async () => { await handlePmGtc("Pm_GtcCommand", { id: body().id, revision: 4, command: JSON.stringify({ kind: "close" }), owner: "foreign" }, "owner"); expect(mocks.command).toHaveBeenCalledWith("owner", body().id, 4, { kind: "close" }); });
});

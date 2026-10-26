import type { GtcPlan } from "@changmen/shared/pm_gtc";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ post: vi.fn(), session: 1, user: "owner", preview: false, maker: `0x${"a".repeat(40)}` }));
vi.mock("@/api/client", () => ({ post: mock.post, unwrap: (response: { success: number; info: unknown; msg?: string }) => {
  if (response.success !== 1) throw new Error(response.msg); return response.info;
}, getAuthSessionVersion: () => mock.session, isAuthSessionCurrent: (session: number) => session === mock.session }));
vi.mock("@/stores/userStore", () => ({ useUserStore: () => ({ userId: mock.user, isLoggedIn: true }) }));
vi.mock("@/stores/accountStore", () => ({ useAccountStore: () => ({ adminWorkspacePreview: mock.preview,
  findAccount: (id: number) => id === 1 ? { accountId: 1, provider: "Polymarket" } : { accountId: 2, provider: "RAY" } }) }));
vi.mock("@changmen/venue-browser/adapter/polymarket", () => ({ pmSubmitMaker: () => mock.maker }));
const id = "11111111-1111-4111-8111-111111111111";
const plan = { playerId: 1, otherPlayerId: 2, originalPmLeg: "A", otherProvider: "RAY", otherTarget: "Away", otherOdds: 2, otherStake: 10, target: "Home", protocol: 2, orderHash: `0x${"b".repeat(64)}`, price: "0.5", shares: "10", targetShares: "10", maxPrincipal: "5", allInBudget: "5", fx: 6.7, parallel: false, negRisk: false, betRowId: 42 } as GtcPlan;
let api: typeof import("./api");
beforeEach(async () => { vi.resetModules(); vi.clearAllMocks(); vi.stubGlobal("indexedDB", new IDBFactory());
  mock.session = 1; mock.user = "owner"; mock.preview = false; mock.post.mockResolvedValue({ success: 1, info: [] }); api = await import("./api"); });
it("has no old creation entry and never grants another send for restored records", async () => {
  expect(api).not.toHaveProperty("createGtc");
  const { createGtcExecution } = await import("@changmen/shared/pm_gtc");
  const row = createGtcExecution(id, "owner", "wallet", mock.maker, plan, 1);
  await expect(api.commandGtc(row, { kind: "authorize_pm" })).rejects.toThrow("禁止重发");
  await expect(api.commandGtc(row, { kind: "authorize_other" })).rejects.toThrow("禁止重发");
  expect(mock.post).not.toHaveBeenCalled();
});
it("imports legacy execution once as read-only, retaining consumed send permits", async () => {
  const { createGtcExecution } = await import("@changmen/shared/pm_gtc");
  const row = { ...createGtcExecution(id, "owner", "wallet", mock.maker, plan, 1), pmAuthorized: true, submit: "dispatching" as const };
  mock.post.mockResolvedValue({ success: 1, info: [row] });
  await api.listGtc(); await vi.waitFor(async () => expect(await api.listGtc()).toHaveLength(1));
  await expect(api.commandGtc((await api.listGtc())[0]!, { kind: "authorize_pm" })).rejects.toThrow("禁止重发");
  await vi.waitFor(() => expect(mock.post).toHaveBeenCalledOnce());
  expect(mock.post.mock.calls[0]![0]).toBe("Pm_GtcList");
});
it("local recovery works when RDS is unavailable and legacy reads back off", async () => {
  const { createGtcExecution } = await import("@changmen/shared/pm_gtc");
  const { importLocalGtc } = await import("./localStore");
  await importLocalGtc("owner", [createGtcExecution(id, "owner", "wallet", mock.maker, plan, 1)]);
  mock.post.mockRejectedValue(new Error("offline"));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await api.listGtc()).toHaveLength(1);
  await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
  await api.listGtc(); expect(mock.post).toHaveBeenCalledOnce(); warn.mockRestore();
  await expect(api.listGtc(42)).rejects.toThrow("旧成交历史尚未恢复");
});

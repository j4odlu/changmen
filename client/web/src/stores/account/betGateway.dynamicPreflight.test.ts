import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { BetOption } from "@changmen/client-core/models/betOption";
import type { PlatformAccount } from "@/models/platformAccount";
import type { AccountStoreContext } from "./context";
import { checkBetting } from "./betGateway";
import { setPmFokPreflightMode } from "@changmen/venue-adapter/polymarket";

const io = vi.hoisted(() => ({ prepare: vi.fn(), check: vi.fn(), gtc: vi.fn() }));
vi.mock("@changmen/venue-adapter/polymarket", async original => ({
  ...await original<typeof import("@changmen/venue-adapter/polymarket")>(),
  prepareOptimizedFokExecution: io.prepare,
}));
vi.mock("@changmen/venue-browser/polymarket/gtc/index", () => ({ checkGtcBuy: io.gtc }));
vi.mock("@/runtime/providers", () => ({ getProvider: () => ({ checkBet: io.check }) }));
const account = { accountId: 1, provider: "Polymarket", currency: "CNY" } as PlatformAccount;
const store = {} as AccountStoreContext;
function leg() {
  const option = new BetOption("Polymarket", "m", "b", "token", 10, "Home", 2);
  option.saveLog = vi.fn();
  return option;
}
beforeEach(() => {
  setActivePinia(createPinia()); vi.resetAllMocks(); setPmFokPreflightMode("optimized");
  io.check.mockImplementation(async (_account, option) => { option.data = { prepared: true }; return option; });
  io.gtc.mockImplementation(async (_account, option) => option);
});
afterEach(() => setPmFokPreflightMode("legacy"));

it("retry CLOB confirmation does not skip preparation; no book starts until preparation completes", async () => {
  let release!: () => void;
  io.prepare.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const task = checkBetting(store, account, leg(), { requireClobConfirmation: true });
  expect(io.prepare).toHaveBeenCalledOnce(); expect(io.check).not.toHaveBeenCalled();
  release();
  expect((await task).checkError).toBeUndefined(); expect(io.check).toHaveBeenCalledOnce();
});

it("failed retry preparation blocks before quote capture and adapter checks", async () => {
  io.prepare.mockRejectedValueOnce(new Error("clock unavailable"));
  const result = await checkBetting(store, account, leg(), { requireClobConfirmation: true });
  expect(result.checkError).toBe("clock unavailable"); expect(result.data).toBeFalsy();
  expect(io.check).not.toHaveBeenCalled();
});

it("classic FOK and GTC never enter dynamic preparation", async () => {
  setPmFokPreflightMode("legacy");
  await checkBetting(store, account, leg(), { requireClobConfirmation: true });
  setPmFokPreflightMode("optimized");
  await checkBetting(store, account, leg(), { pmOrderMode: "GTC" });
  expect(io.prepare).not.toHaveBeenCalled(); expect(io.check).toHaveBeenCalledOnce(); expect(io.gtc).toHaveBeenCalledOnce();
});

it("precheck-only legs never prepare a signing environment", async () => {
  await checkBetting(store, account, leg(), { role: "precheckOnly", requireClobConfirmation: true });
  expect(io.prepare).not.toHaveBeenCalled(); expect(io.check).toHaveBeenCalledOnce();
});

it("an already prepared pair does not wait again inside either precheck", async () => {
  await checkBetting(store, account, leg(), { requireClobConfirmation: true, pmDynamicPrepared: true });
  expect(io.prepare).not.toHaveBeenCalled(); expect(io.check).toHaveBeenCalledOnce();
});

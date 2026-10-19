import type { VenueOrder } from "@changmen/client-core/contract";
import { resolveA8VenueLegOutcome } from "@changmen/venue-adapter/adaptation";
import { BetOption } from "@changmen/client-core/models/betOption";
import { BetResult } from "@changmen/client-core/models/betResult";
import { beforeEach, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { observedRayOrders, resetRayOrderResults } from "@/runtime/orderMonitoring/rayOrders";
import { getProvider } from "@/runtime/providers";
import { readRayAccountOrders, resetRayOrderPolling } from "./ray";

const mocks = vi.hoisted(() => ({ read: vi.fn(), check: vi.fn(), bet: vi.fn(), settle: vi.fn(), wait: vi.fn(), preview: vi.fn(), accept: vi.fn() }));
vi.mock("@/runtime/rayOrderMonitor/submissionPreview", () => ({ beginRaySubmissionPreview: mocks.preview }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => "owner", isAuthSessionCurrent: () => true }));
vi.mock("@/runtime/venueAdapters", () => ({ getProvider: () => ({ getOrders: mocks.read, checkBet: mocks.check, betting: mocks.bet, resolveLegOutcome: mocks.settle }) }));
vi.mock("@changmen/venue-adapter/shared/rejectWait", () => ({ venueRejectWaitBeforePoll: mocks.wait }));
const account = () => new PlatformAccount({ accountId: 1, provider: "RAY", token: "test", playerName: "RAY" });
function order(orderId: string, status: VenueOrder["status"]): VenueOrder {
  return {
    provider: "RAY",
    orderId,
    status,
    createAt: 1,
    odds: 2,
    betMoney: 100,
    money: 0,
    reward: 0,
    game: "",
    match: "",
    bet: "",
    item: "",
  };
}
beforeEach(() => {
  resetRayOrderPolling(); resetRayOrderResults(); vi.resetAllMocks();
  mocks.read.mockResolvedValue([]); mocks.wait.mockResolvedValue(undefined);
  mocks.preview.mockReturnValue(mocks.accept);
});

it.each([false, true])("public queries stay independent when active=%s", async (active) => {
  const acc = account(); acc.active = active;
  const provider = getProvider(acc)!;
  await Promise.all([provider.getOrders!(acc), provider.getOrders!(acc)]);
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(mocks.bet).not.toHaveBeenCalled(); expect(mocks.preview).not.toHaveBeenCalled();
  expect(provider.checkBet).toBe(mocks.check); expect(provider.resolveLegOutcome).toBe(mocks.settle);
});

it("a pending monitor read cannot replace the read after the FOK rejection wait", async () => {
  const acc = account(); acc.active = false;
  let release!: (orders: VenueOrder[]) => void;
  mocks.read.mockImplementationOnce(() => new Promise<VenueOrder[]>((resolve) => { release = resolve; }))
    .mockResolvedValueOnce([order("new-rejected", "reject")]);
  const background = readRayAccountOrders(acc);
  await Promise.resolve(); await Promise.resolve();
  const provider = getProvider(acc)!;
  const confirmation = resolveA8VenueLegOutcome(provider, acc, undefined, {
    rejectWaitSec: 30,
    fetchVenueOrders: () => provider.getOrders!(acc),
  });
  await Promise.resolve(); await Promise.resolve();
  release([order("old-accepted", "none")]);
  expect(await confirmation).toMatchObject({ settlement: "unfilled", orders: [{ orderId: "new-rejected" }] });
  expect(await background).toMatchObject([{ orderId: "old-accepted" }]);
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(mocks.wait).toHaveBeenCalledWith(30);
});

it("one failed public query cannot replace another caller's successful query", async () => {
  const acc = account();
  mocks.read.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValueOnce([order("new", "none")]);
  const results = await Promise.allSettled([getProvider(acc)!.getOrders!(acc), getProvider(acc)!.getOrders!(acc)]);
  expect(results[0].status).toBe("rejected");
  expect(results[1]).toMatchObject({ status: "fulfilled", value: [{ orderId: "new" }] });
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("observing a normal query keeps its exact response and confirmation method references", async () => {
  const acc = account(); const orders = [order("original", "reject")];
  mocks.read.mockResolvedValue(orders);
  const provider = getProvider(acc)!;
  expect(await provider.getOrders!(acc)).toBe(orders);
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(acc);
  expect(observedRayOrders(acc)?.orders).toEqual(orders);
  expect(provider.checkBet).toBe(mocks.check); expect(mocks.bet).not.toHaveBeenCalled();
  expect(provider.resolveLegOutcome).toBe(mocks.settle);
});

it("the RAY submission observer forwards one original call and the exact receipt", async () => {
  const acc = account(); const option = new BetOption("RAY", "1", "2", "3", 100, "Home", 2);
  const receipt = new BetResult("RAY", true); mocks.bet.mockResolvedValue(receipt);
  const provider = getProvider(acc)!;
  expect(await provider.betting(acc, option)).toBe(receipt);
  expect(mocks.bet).toHaveBeenCalledExactlyOnceWith(acc, option);
  expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(acc, option);
  expect(mocks.accept).toHaveBeenCalledExactlyOnceWith(receipt);
  expect(mocks.read).not.toHaveBeenCalled();
});

it("a rejected submission preserves the original error without accepting a preview", async () => {
  const acc = account(); const option = new BetOption("RAY", "1", "2", "3", 100, "Home", 2);
  const error = new Error("original submission failed"); mocks.bet.mockRejectedValue(error);
  await expect(getProvider(acc)!.betting(acc, option)).rejects.toBe(error);
  expect(mocks.bet).toHaveBeenCalledExactlyOnceWith(acc, option);
  expect(mocks.accept).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
});

it("non-RAY queries never publish a RAY monitoring snapshot", async () => {
  const acc = new PlatformAccount({ accountId: 1, provider: "OB", playerName: "OB" });
  const provider = getProvider(acc)!;
  expect(provider.getOrders).toBe(mocks.read);
  expect(provider.betting).toBe(mocks.bet);
  await provider.getOrders!(acc);
  expect(observedRayOrders(acc)).toBeUndefined();
});

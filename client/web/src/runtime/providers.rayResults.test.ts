import type { VenueOrder } from "@changmen/venue-adapter/contract";
import { beforeEach, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { observedRayOrders, resetRayOrderResults } from "./orderMonitoring/rayOrders";
import { getProvider } from "./providers";

const mocks = vi.hoisted(() => ({ read: vi.fn(), check: vi.fn(), bet: vi.fn(), settle: vi.fn() }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => 1, isAuthSessionCurrent: () => true }));
vi.mock("@/runtime/venueAdapters", () => ({ getProvider: () => ({ getOrders: mocks.read, checkBet: mocks.check, betting: mocks.bet, resolveLegOutcome: mocks.settle }) }));
const account = () => new PlatformAccount({ accountId: 2, provider: "RAY", playerName: "RAY" });
const order = (status: VenueOrder["status"]) => ({ provider: "RAY", orderId: "one", status }) as VenueOrder;
beforeEach(() => { resetRayOrderResults(); vi.resetAllMocks(); });

it.each([false, true])("observing results preserves every original query and method when active=%s", async (active) => {
  const acc = account(); acc.active = active;
  const first = [order("none")]; const second = [order("reject")];
  mocks.read.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  const provider = getProvider(acc)!;
  const results = await Promise.all([provider.getOrders!(acc), provider.getOrders!(acc)]);
  expect(results[0]).toBe(first); expect(results[1]).toBe(second);
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(provider.checkBet).toBe(mocks.check); expect(provider.betting).toBe(mocks.bet); expect(provider.resolveLegOutcome).toBe(mocks.settle);
});

it("a late old query preserves its caller's result while never replacing newer confirmation evidence", async () => {
  const acc = account(); const old = [order("none")]; const rejected = [order("reject")];
  let release!: (orders: VenueOrder[]) => void;
  mocks.read.mockImplementationOnce(() => new Promise<VenueOrder[]>((resolve) => { release = resolve; })).mockResolvedValueOnce(rejected);
  const provider = getProvider(acc)!;
  const pending = provider.getOrders!(acc);
  expect(await provider.getOrders!(acc)).toBe(rejected);
  release(old); expect(await pending).toBe(old);
  expect(observedRayOrders(acc)!.orders[0]!.status).toBe("reject");
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("query errors remain independent and never trigger retries or hide another successful response", async () => {
  const acc = account(); const failure = new Error("Network Error");
  mocks.read.mockRejectedValueOnce(failure).mockResolvedValueOnce([order("reject")]);
  const provider = getProvider(acc)!;
  const results = await Promise.allSettled([provider.getOrders!(acc), provider.getOrders!(acc)]);
  expect(results[0]).toEqual({ status: "rejected", reason: failure });
  expect(results[1]).toMatchObject({ status: "fulfilled", value: [{ status: "reject" }] });
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

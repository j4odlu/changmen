import type { VenueOrder } from "@changmen/venue-adapter/contract";
import { beforeEach, expect, it, vi } from "vitest";
import { PlatformAccount } from "@/models/platformAccount";
import { beginRayOrderObservation, observedRayOrders, resetRayOrderResults } from "./rayOrders";

const mocks = vi.hoisted(() => ({ session: 1, valid: true }));
vi.mock("@/api/client", () => ({ getAuthSessionVersion: () => mocks.session, isAuthSessionCurrent: (session: number) => mocks.valid && session === mocks.session }));
const account = (id = 2) => new PlatformAccount({ accountId: id, provider: "RAY", playerName: "RAY", gateway: "https://ray.example", token: "token" });
const order = (status: VenueOrder["status"] = "none") => ({ provider: "RAY", orderId: "one", status }) as VenueOrder;
beforeEach(() => { resetRayOrderResults(); mocks.session = 1; mocks.valid = true; });

it("consumers receive immutable copies without modifying the original query response", () => {
  const acc = account(); const original = order();
  beginRayOrderObservation(acc)([original]);
  const snapshot = observedRayOrders(acc)!;
  expect(snapshot.orders).toEqual([original]); expect(snapshot.orders[0]).not.toBe(original);
  expect(Object.isFrozen(snapshot.orders[0])).toBe(true);
  original.status = "reject";
  expect(snapshot.orders[0]!.status).toBe("none");
});

it("a slow older request cannot replace the result of a later rejection confirmation", () => {
  const acc = account(); const older = beginRayOrderObservation(acc); const newer = beginRayOrderObservation(acc);
  newer([order("reject")]); older([order()]);
  expect(observedRayOrders(acc)!.orders[0]!.status).toBe("reject");
});

it.each(["session", "token", "gateway", "reset"])("late results are discarded after %s changes", (change) => {
  const acc = account(); const publish = beginRayOrderObservation(acc);
  if (change === "session")
    mocks.session++;
  if (change === "token")
    acc.token = "replacement";
  if (change === "gateway")
    acc.gateway = "https://new.example";
  if (change === "reset")
    resetRayOrderResults();
  publish([order("reject")]);
  expect(observedRayOrders(acc)).toBeUndefined();
});

it("accounts and credential bindings never reuse each other's responses", () => {
  const acc = account(); beginRayOrderObservation(acc)([order()]);
  expect(observedRayOrders(account(3))).toBeUndefined();
  expect(observedRayOrders(account())).toBeDefined();
  acc.token = "replacement"; expect(observedRayOrders(acc)).toBeUndefined();
});

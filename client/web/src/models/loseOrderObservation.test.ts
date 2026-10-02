import type { ObservationContext } from "@changmen/shared/order_observation";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";
import { useLoseOrderStore } from "@/stores/loseOrderStore";
import { LoseOrder } from "./loseOrder";

vi.mock("@/services/orderObservation", () => ({
  createObservationContext: () => undefined,
  observeOrder: (context?: ObservationContext) => {
    if (context)
      context.sequence = (context.sequence || 0) + 1;
  },
}));

describe("补单观察元数据兼容", () => {
  const raw = { accountId: 1, matchId: 2, betId: 3, target: "Away" as const, betMoney: 100, betOdds: 2, linkId: 123, match: "m", bet: "b", createAt: 1000, isCreateOrder: false, betCount: 1 };
  it("round-trips the original queue and pending attempt without generating identities for old records", () => {
    const observation = { ownerUserId: "u1", queueId: "q1", anchorAttemptId: "a1", anchorOrderId: "o1", sequence: 4 };
    const pendingObservation = { ownerUserId: "u1", queueId: "q1", attemptId: "a2", sequence: 7 };
    const restored = new LoseOrder(JSON.parse(JSON.stringify(new LoseOrder({ ...raw, observation, pendingObservation }))));
    expect(restored.observation).toEqual(observation);
    expect(restored.pendingObservation).toEqual(pendingObservation);
    expect(restored.getBetMoney(2)).toBe(100);
    expect(new LoseOrder(raw).observation).toBeUndefined();
    expect(new LoseOrder(raw).pendingObservation).toBeUndefined();
  });
  it("keeps the betId overwrite and removal semantics unchanged", () => {
    setActivePinia(createPinia());
    const store = useLoseOrderStore();
    store.orders.clear();
    // node 测试无 sessionStorage；持久化与业务语义分开验证。
    store.persist = () => {};
    store.createOrder(new LoseOrder({ ...raw, observation: { queueId: "q1", ownerUserId: "u1" } }));
    const replacement = new LoseOrder({ ...raw, observation: { queueId: "q2", ownerUserId: "u1" }, betCount: 2 });
    store.createOrder(replacement);
    expect(store.orders.size).toBe(1);
    expect(store.orders.get(raw.betId)?.observation?.queueId).toBe("q2");
    expect(store.orders.get(raw.betId)?.betCount).toBe(2);
    store.removeOrder(raw.betId);
    expect(store.orders.get(raw.betId)?.betCount).toBe(1);
    store.removeOrder(raw.betId, true);
    expect(store.orders.size).toBe(0);
  });

  it("persists the queue creation sequence and clears only pending observation metadata", () => {
    setActivePinia(createPinia());
    const store = useLoseOrderStore();
    const snapshots: LoseOrder[] = [];
    store.persist = () => { snapshots.push(new LoseOrder(store.orders.get(raw.betId)!.toJSON())); };
    store.createOrder(new LoseOrder({ ...raw, observation: { queueId: "q1", ownerUserId: "u1" } }));
    expect(snapshots[0]?.observation?.sequence).toBe(1);
    store.setPendingVenueOrder(raw.betId, "o1", 1, { observation: { attemptId: "a1", ownerUserId: "u1" } });
    store.clearPendingVenueOrder(raw.betId);
    expect(store.orders.get(raw.betId)?.pendingObservation).toBeUndefined();
    expect(store.orders.get(raw.betId)?.observation?.queueId).toBe("q1");
    expect(store.orders.get(raw.betId)?.betCount).toBe(1);
  });
});

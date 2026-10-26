import { createLegacyGtc as createLocalGtc } from "@/test/legacyGtcWriter";
import type { GtcPlan } from "@changmen/shared/pm_gtc";
import type { GtcOrderPlan } from "@changmen/shared/pm_gtc_order";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, expect, it, vi } from "vitest";
import { createStoredGtcOrder, listStoredGtcOrders, mutateStoredGtcOrder } from "./orderStore";
import { listLocalGtc, pendingGtcResults, finishGtcResult } from "./localStore";
import { request, transaction } from "./storage";

const hash = `0x${"c".repeat(64)}`;
const maker = `0x${"a".repeat(40)}`;
const plan: GtcOrderPlan = { tokenId: "token", conditionId: "condition", shares: "10", targetShares: "10", price: "0.5",
  maxPrincipal: "5", allInBudget: "5", protocol: 2, negRisk: false, route: "direct", orderHash: hash };
beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange); });
it("keeps the same database/indexes while old owner-index readers cannot see native records", async () => {
  const row = await createStoredGtcOrder("id", "owner", 1, maker, plan, { linkId: -10, item: "YES" });
  const values = await transaction(["records"], "readonly", async tx => await request(tx.objectStore("records").getAll()));
  expect(values).toHaveLength(1); expect(values[0]).toHaveProperty("order.formatVersion", 2);
  expect(values[0]).not.toHaveProperty("row"); expect(values[0]).not.toHaveProperty("owner");
  expect(row.plan).not.toHaveProperty("otherTarget"); expect(row).not.toHaveProperty("other");
  expect(await listLocalGtc("owner")).toEqual([]); expect(await listStoredGtcOrders("owner")).toEqual([row]);
});
it.each(["legacy-first", "native-first"])("shares the hash uniqueness constraint with old writers: %s", async order => {
  const legacy = { ...plan, playerId: 1 } as GtcPlan;
  if (order === "legacy-first") {
    await createLocalGtc("owner", "old-id", maker, legacy);
    await expect(createStoredGtcOrder("new-id", "owner", 1, maker, plan, {})).rejects.toThrow("禁止重复发送");
  }
  else {
    await createStoredGtcOrder("new-id", "owner", 1, maker, plan, {});
    await expect(createLocalGtc("owner", "old-id", maker, legacy)).rejects.toThrow("禁止重复发送");
  }
});
it("grants only one creation and one durable send authorization across concurrent callers", async () => {
  const created = await Promise.allSettled([createStoredGtcOrder("one", "owner", 1, maker, plan, {}), createStoredGtcOrder("two", "owner", 1, maker, plan, {})]);
  expect(created.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const row = (await listStoredGtcOrders("owner"))[0]!;
  const attempts = await Promise.allSettled([mutateStoredGtcOrder("owner", row.id, 0, { kind: "authorize" }), mutateStoredGtcOrder("owner", row.id, 0, { kind: "authorize" })]);
  expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const latest = (await listStoredGtcOrders("owner"))[0]!;
  await expect(mutateStoredGtcOrder("owner", row.id, latest.revision, { kind: "authorize" })).rejects.toThrow("禁止重发");
});
it("isolates owner keys even when account ids and signed hashes match", async () => {
  await createStoredGtcOrder("one", "owner", 1, maker, plan, {});
  await createStoredGtcOrder("two", "owner:other", 1, maker, plan, {});
  expect((await listStoredGtcOrders("owner")).map(row => row.id)).toEqual(["one"]);
  expect(await listStoredGtcOrders("absent")).toEqual([]);
  await expect(mutateStoredGtcOrder("owner:other", "one", 0, { kind: "authorize" })).rejects.toThrow("归属无效");
});
it("persists only order fields, excluding credentials, functions and pairing metadata", async () => {
  const row = await createStoredGtcOrder("id", "owner", 1, maker, { ...plan, privateKey: "secret", otherPlayerId: 9, submit: () => {} } as GtcOrderPlan, {});
  expect(row.plan).toEqual(plan); expect(JSON.stringify(await listStoredGtcOrders("owner"))).not.toContain("secret");
});
it("queues confirmed partial fills under one original id, and FAILED evidence corrects that same result", async () => {
  let row = await createStoredGtcOrder("id", "owner", 1, maker, plan, { linkId: -10, match: "M", bet: "B", item: "YES" });
  row = await mutateStoredGtcOrder("owner", row.id, row.revision, { kind: "authorize" });
  row = await mutateStoredGtcOrder("owner", row.id, row.revision, { kind: "receipt", receipt: { success: true, orderID: hash } });
  expect(await pendingGtcResults("owner")).toEqual([]);
  const fill = { key: "one", tradeId: "one", bucket: "maker", role: "MAKER" as const, shares: "3", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 1 };
  row = await mutateStoredGtcOrder("owner", row.id, row.revision, { kind: "facts", facts: { order: { id: hash, original: "10", matched: "3", status: "LIVE", tradeIds: ["one"] }, fills: [fill], complete: true, observedAt: 1 } });
  const before = (await pendingGtcResults("owner"))[0]!;
  expect(before.result).toMatchObject({ executionId: "id", playerId: 1, orderId: hash, buyShares: "3", principalUsdc: "1.5", feeUsdc: "0" });
  row = await mutateStoredGtcOrder("owner", row.id, row.revision, { kind: "facts", facts: { order: { id: hash, original: "10", matched: "0", status: "CANCELED", tradeIds: ["one"] }, fills: [{ ...fill, status: "FAILED", updatedAt: 2 }], complete: true, observedAt: 2 } });
  await finishGtcResult(before);
  const latest = (await pendingGtcResults("owner"))[0]!;
  expect(latest.result).toMatchObject({ executionId: "id", buyShares: "0", principalUsdc: "0", financial: { pmShares: 0 } });
  expect(latest.result.revision).toBe(row.revision); expect(await listStoredGtcOrders("owner")).toHaveLength(1);
});

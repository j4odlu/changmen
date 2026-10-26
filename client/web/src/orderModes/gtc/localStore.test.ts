import { createLegacyGtc as createLocalGtc } from "@/test/legacyGtcWriter";
import type { GtcPlan } from "@changmen/shared/pm_gtc";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, expect, it, vi } from "vitest";
import { listLocalGtc, mutateLocalGtc, pendingGtcResults, finishGtcResult } from "./localStore";
const hash = `0x${"a".repeat(64)}`;
const plan = { playerId: 1, otherPlayerId: 2, otherProvider: "RAY", orderHash: hash, shares: "10", match: "m", bet: "b", item: "i", linkId: 123, tokenId: "token", conditionId: "condition" } as GtcPlan;
beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });
it("persists before granting sends and rejects duplicate authorization across concurrent callers and reload", async () => {
  const row = await createLocalGtc("owner", "id", "maker", plan);
  const results = await Promise.allSettled([mutateLocalGtc("owner", "id", row.revision, { kind: "authorize_pm" }), mutateLocalGtc("owner", "id", row.revision, { kind: "authorize_pm" })]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const restored = (await listLocalGtc("owner"))[0]!;
  expect(restored.pmAuthorized).toBe(true);
  await expect(mutateLocalGtc("owner", "id", restored.revision, { kind: "authorize_pm" })).rejects.toThrow("禁止重发");
  await expect(createLocalGtc("owner", "new-id", "maker", plan)).rejects.toThrow("禁止重复发送");
});
it("persists user isolation and blocks sends when client storage is unavailable", async () => {
  await createLocalGtc("owner", "id", "maker", plan);
  expect(await listLocalGtc("other-owner")).toEqual([]);
  await expect(mutateLocalGtc("other-owner", "id", 0, { kind: "authorize_pm" })).rejects.toThrow("不存在");
  vi.stubGlobal("indexedDB", undefined);
  await expect(createLocalGtc("owner", "other", "maker", { ...plan, orderHash: "other" })).rejects.toThrow("尚未发送");
});
it("another page or reload cannot overwrite an in-flight dispatch as not sent", async () => {
  let row = await createLocalGtc("owner", "id", "maker", plan);
  row = await mutateLocalGtc("owner", "id", row.revision, { kind: "authorize_pm" });
  vi.resetModules();
  const peer = await import("./localStore");
  await expect(peer.mutateLocalGtc("owner", "id", row.revision, { kind: "not_sent", leg: "PM", message: "permit lost" })).rejects.toThrow("发送许可");
  expect((await peer.listLocalGtc("owner"))[0]!.submit).toBe("dispatching");
  const closed = await peer.mutateLocalGtc("owner", "id", row.revision, { kind: "close" });
  await expect(peer.mutateLocalGtc("owner", "id", closed.revision, { kind: "authorize_pm" })).rejects.toThrow("禁止重发");
});
it("cancel intention survives reload, and neither cancellation nor unknown fees create an RDS result", async () => {
  let row = await createLocalGtc("owner", "id", "maker", plan);
  row = await mutateLocalGtc("owner", "id", row.revision, { kind: "authorize_pm" });
  row = await mutateLocalGtc("owner", "id", row.revision, { kind: "ack", state: "accepted", orderId: hash });
  row = await mutateLocalGtc("owner", "id", row.revision, { kind: "facts", facts: {
    order: { id: hash, original: "10", matched: "3", status: "LIVE", tradeIds: ["one"] },
    fills: [{ key: "one", tradeId: "one", bucket: "maker", role: "MAKER", shares: "3", price: "0.5", fee: null, status: "CONFIRMED", updatedAt: 1 }], complete: true, observedAt: 1,
  } });
  row = await mutateLocalGtc("owner", "id", row.revision, { kind: "cancel", commandId: "cancel" });
  expect((await listLocalGtc("owner"))[0]!.cancel!.commandId).toBe("cancel");
  expect(await pendingGtcResults("owner")).toEqual([]);
  row = await mutateLocalGtc("owner", "id", row.revision, { kind: "facts", facts: {
    order: { id: hash, original: "10", matched: "0", status: "CANCELED", tradeIds: ["one"] },
    fills: [{ ...row.fills.one!, fee: "0", status: "FAILED", updatedAt: 2 }], complete: true, observedAt: 2,
  } });
  expect(row.cancel!.state).toBe("acknowledged");
  expect((await pendingGtcResults("owner"))[0]!.result.financial.pmShares).toBe(0);
});
it("queues only confirmed partial fills and retains a newer result while the previous synchronization finishes", async () => {
  let row = await createLocalGtc("owner", "id", "maker", plan);
  row = await mutateLocalGtc("owner", "id", row.revision, { kind: "authorize_pm" });
  row = await mutateLocalGtc("owner", "id", row.revision, { kind: "ack", state: "accepted", orderId: hash });
  expect(await pendingGtcResults("owner")).toEqual([]);
  const fill = { key: "one", tradeId: "one", bucket: "maker", role: "MAKER" as const, shares: "3.000001", price: "0.5", fee: "0", status: "CONFIRMED", updatedAt: 1 };
  row = await mutateLocalGtc("owner", "id", row.revision, { kind: "facts", facts: { order: { id: hash, original: "10", matched: "5.000001", status: "LIVE", tradeIds: ["one", "two"] },
    fills: [fill, { ...fill, key: "two", tradeId: "two", shares: "2", status: "MATCHED" }], complete: true, observedAt: 1 } });
  const first = (await pendingGtcResults("owner"))[0]!;
  expect(first.result.financial.pmShares).toBe(3.000001);
  expect(first.result).not.toHaveProperty("pmAuthorized"); expect(first.result).not.toHaveProperty("cancel");
  row = await mutateLocalGtc("owner", "id", row.revision, { kind: "facts", facts: { order: { id: hash, original: "10", matched: "5.000001", status: "LIVE", tradeIds: ["one", "two"] },
    fills: [{ ...fill, key: "two", tradeId: "two", shares: "2", updatedAt: 2 }], complete: true, observedAt: 2 } });
  await finishGtcResult(first);
  await finishGtcResult(first, true);
  const latest = (await pendingGtcResults("owner"))[0]!;
  expect(latest.result.financial.pmShares).toBe(5.000001);
  expect(latest.failures).toBe(0);
  expect((await listLocalGtc("owner"))[0]!.financialOrder!.pmShares).toBe(5.000001);
  await finishGtcResult(latest, true);
  const retry = (await pendingGtcResults("owner"))[0]!;
  expect(retry.failures).toBe(1); expect(retry.at).toBeGreaterThan(Date.now());
  await finishGtcResult(latest);
  await mutateLocalGtc("owner", "id", row.revision, { kind: "close" });
  expect(await pendingGtcResults("owner")).toEqual([]);
});

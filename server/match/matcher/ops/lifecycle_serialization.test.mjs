import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), end: vi.fn(), restore: vi.fn(), merge: vi.fn() }));
vi.mock("@changmen/db", () => ({ fetchClientMatchRow: mocks.fetch, forceEndClientMatch: mocks.end, clearClientMatchEndedAt: mocks.restore }));
vi.mock("./match_merge_once.js", () => ({ matchMergeOnce: mocks.merge }));
vi.mock("./rds_snapshot_cache.js", () => ({ invalidateMatcherRdsSnapshot: vi.fn() }));
vi.mock("../runtime_ports.js", () => ({ removeClientMatchFromMemory: vi.fn() }));
import { withMatcherWriteLock } from "../lib/write_guard.js";
import { forceEndClientMatch } from "./delete_client_match.js";
import { restoreClientMatch } from "./restore_client_match.js";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => vi.clearAllMocks());

it.each(["end", "restore"])("waits for an in-flight snapshot write before manual %s", async action => {
  const started = deferred(), release = deferred();
  const writer = withMatcherWriteLock(async () => { started.resolve(); await release.promise; });
  await started.promise;
  mocks.fetch.mockResolvedValue({ id: 42, title: "A vs B", ended_at: action === "restore" ? 1 : null });
  mocks.end.mockResolvedValue({ ended_at: 123 });
  const operation = action === "end" ? forceEndClientMatch(42) : restoreClientMatch(42);
  await Promise.resolve();
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.end).not.toHaveBeenCalled();
  expect(mocks.restore).not.toHaveBeenCalled();
  release.resolve();
  await writer;
  await operation;
  expect(action === "end" ? mocks.end : mocks.restore).toHaveBeenCalledExactlyOnceWith(42);
  expect(mocks.merge).toHaveBeenCalledExactlyOnceWith({ afterInFlight: true });
});

it("releases the queue after a failed write so later state changes can run", async () => {
  const failing = withMatcherWriteLock(async () => { throw new Error("write failed"); });
  const next = withMatcherWriteLock(async () => "next write");
  await expect(failing).rejects.toThrow("write failed");
  await expect(next).resolves.toBe("next write");
});

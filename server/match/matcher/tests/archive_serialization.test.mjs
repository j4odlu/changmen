import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ prune: vi.fn(), archive: vi.fn(), merge: vi.fn() }));
vi.mock("@changmen/db", () => ({
  pruneMatchesOlderThanCollectPast: mocks.prune, archiveStaleClientMatchRows: mocks.archive,
  formatArchiveCounts: () => "test",
  DEFAULT_CLIENT_MATCH_ARCHIVE_INTERVAL_MS: 3600000,
}));
vi.mock("../ops/match_merge_once.js", () => ({ ensureTeamPlugin: vi.fn(), matchMergeOnce: mocks.merge }));
vi.mock("../lib/heartbeat.js", () => ({ writeMatcherHeartbeat: vi.fn() }));
vi.mock("../lib/write_guard.js", async importOriginal => {
  // 心跳在此测试中被替换，仅复用真实的串行锁。
  const original = await importOriginal();
  return { withMatcherWriteLock: original.withMatcherWriteLock };
});
import { withMatcherWriteLock } from "../lib/write_guard.js";
import { runMatcherOnce } from "../loop.js";

it("keeps automatic expiry ending behind an in-flight match write", async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const writer = withMatcherWriteLock(async () => { entered(); await wait; });
  await started;
  mocks.prune.mockResolvedValue({ client: { ended: 1 } });
  mocks.archive.mockResolvedValue({ rds: null });
  mocks.merge.mockResolvedValue({ matchCount: 0 });
  const tick = runMatcherOnce();
  await Promise.resolve();
  expect(mocks.prune).not.toHaveBeenCalled();
  release();
  await writer;
  await tick;
  expect(mocks.prune).toHaveBeenCalledOnce();
  expect(mocks.merge).toHaveBeenCalledOnce();
});

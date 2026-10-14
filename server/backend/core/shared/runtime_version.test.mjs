import { expect, it, vi } from "vitest";
vi.mock("@changmen/db", () => ({ getPgPool: () => null }));
import { createRuntimeVersionReader } from "./runtime_version.js";

it("old processes retain their loaded commit and clearly report a different working tree", async () => {
  const running = Object.freeze({ commit: "old", sourceFingerprint: "old-source", startedAt: "original" });
  const query = vi.fn(async () => ({ rows: [{ relname: "orders", columns: [] }] }));
  const reader = createRuntimeVersionReader({ running, source: () => ({ commit: "new", sourceFingerprint: "new-source" }), pool: () => ({ query }) });
  const report = await reader();
  expect(report).toMatchObject({ backend: running, workspace: { commit: "new" }, restartRequired: true, database: { status: "observed", migrationVersion: null, migrationTracking: "untracked" } });
  expect(query.mock.calls[0][0].text.trim()).toMatch(/^SELECT /);
  expect(query.mock.calls[0][0].text).not.toMatch(/CREATE|ALTER|UPDATE|DELETE|INSERT/);
  expect(JSON.stringify(report)).not.toContain("relname");
});
it("concurrent manual reads share a bounded metadata query and cache it for 60 seconds", async () => {
  let now = 1, resolve; const query = vi.fn(() => new Promise(done => { resolve = done; }));
  const running = { sourceFingerprint: "same" };
  const reader = createRuntimeVersionReader({ running, source: () => running, pool: () => ({ query }), now: () => now });
  const jobs = [reader(), reader(), reader()]; expect(query).toHaveBeenCalledOnce(); resolve({ rows: [] });
  const reports = await Promise.all(jobs); expect(reports.every(row => row.restartRequired === false)).toBe(true);
  await reader(); expect(query).toHaveBeenCalledOnce(); now += 60001;
  const next = reader(); expect(query).toHaveBeenCalledTimes(2); resolve({ rows: [] }); await next;
  expect(query.mock.calls[0][0].query_timeout).toBe(1500);
});
it.each(["missing", "pool throws", "query throws"])("unavailable schema is unknown; %s cannot leak secrets or disable version reads", async mode => {
  const pool = () => { if (mode === "missing") return null; if (mode === "pool throws") throw Error("secret DSN"); return { query: async () => { throw Error("secret DSN"); } }; };
  const reader = createRuntimeVersionReader({ running: { commit: "loaded", sourceFingerprint: null }, source: () => { throw Error("secret path"); }, pool });
  const report = await reader(); expect(report.restartRequired).toBeNull(); expect(report.database.status).toBe("unavailable");
  expect(JSON.stringify(report)).not.toMatch(/secret|DSN/); expect(report.backend.commit).toBe("loaded");
});

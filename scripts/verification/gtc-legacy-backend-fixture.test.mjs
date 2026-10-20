import { expect, it } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { confirmedResultSyncScenario, exactMonitorApiScenario, legacyBackendScenario, modernMonitorOrdersScenario } from "./gtc-legacy-backend-fixture.mjs";
const source = file => gitSource("832f3f76c30d6ad741ce850a68cd6ba1da7d06f9", file);
it("the actual client sync consumer acknowledges only a confirmed result saved through the real handler", async () => {
  const result = await confirmedResultSyncScenario(file => fs.readFileSync(file, "utf8"));
  expect(result.trace).toEqual([{ action: "Pm_GtcSyncResult" }, { save: "confirmed-result" }, { finish: "acknowledged" }]);
});
it.each(["process", "intermediate", "financial", "owner", "ack"])("the real result chain retains a retry on %s failure", async fault => {
  const result = await confirmedResultSyncScenario(file => fs.readFileSync(file, "utf8"), { fault });
  expect(result.trace.at(-1)).toEqual({ finish: "retry" });
  expect(result.trace.some(row => row.finish === "acknowledged")).toBe(false);
  if (fault !== "ack") expect(result.trace.some(row => row.save)).toBe(false);
  expect(Object.keys(result.issues)).toHaveLength(1);
});
it("real old backend repeated sibling groups across 5000-row raw pages restore the original", async () => {
  const result = await legacyBackendScenario(source, { repeatedGroup: true });
  expect(result.error).toBeUndefined(); expect(result.restored).toHaveLength(1);
  expect(result.restored[0]).toMatchObject({ OrderID: "buy", Status: "Win", PlayerID: 1 });
  expect(result.trace.some(row => row.date === result.ledgerDate && row.pageIndex === 3)).toBe(true);
});
it("real old backend restores a fill posted twenty days later by original Link date", async () => {
  const result = await legacyBackendScenario(source, { lateFill: true });
  expect(result.error).toBeUndefined(); expect(result.restored).toHaveLength(1);
  expect(result.restored[0].CreateAt).toBe(result.record.createdAt + 20 * 86400000);
});
it("real old backend cannot find a buy manually rebound thirty days earlier; never announces successful empty recovery", async () => {
  const result = await legacyBackendScenario(source, { rebound: true });
  expect(result.financialOriginal).toMatchObject({ OrderID: "buy", Status: "Win" });
  expect(result.trace.some(row => row.date === result.ledgerDate)).toBe(false);
  expect(result.restored).toBeUndefined(); expect(result.error).toContain("跨日期改绑");
});
it("current modern exact-id handler restores the same rebound settled original without a date query", async () => {
  const legacy = await legacyBackendScenario(source, { rebound: true });
  const modern = await modernMonitorOrdersScenario(legacy.record, legacy.ledgerRaw, legacy.financialOriginal);
  expect(modern.rows).toHaveLength(1); expect(modern.rows[0]).toMatchObject({ OrderID: "buy", Status: "Win", Link: legacy.ledgerRaw.link });
  expect(modern.reads).toHaveLength(1);
});

it.each(["Win", "Lose", "Return", "Reject"])("real new frontend/route/handler/DTO restores a manually rebound %s original", async (status) => {
  const old = await legacyBackendScenario(source, { rebound: true });
  const result = await exactMonitorApiScenario(old.record, [{ ...old.ledgerRaw, status }]);
  expect(result.error).toBeUndefined();
  expect(result.rows).toHaveLength(1); expect(result.rows[0]).toMatchObject({ Status: status, OrderID: "buy", Link: old.ledgerRaw.link, PmGtcExecutionId: old.record.id });
  expect(result.trace.filter(row => row.action).map(row => row.action)).toEqual(["Pm_GtcReadResults"]);
  expect(result.trace.find(row => row.read === "originals")).toMatchObject({ owner: "owner", player: 1, ids: ["buy"] });
});
it("real new API propagates missing committed original instead of successful empty recovery", async () => {
  const old = await legacyBackendScenario(source, { rebound: true });
  const result = await exactMonitorApiScenario(old.record, []);
  expect(result.rows).toBeUndefined(); expect(result.error).toContain("财务记录缺失");
  expect(result.trace.filter(row => row.action).map(row => row.action)).toEqual(["Pm_GtcReadResults"]);
});
it("missing original remains pending only while its confirmed result is in the client outbox", async () => {
  const old = await legacyBackendScenario(source, { rebound: true });
  const result = await exactMonitorApiScenario(old.record, [], { resultPending: true });
  expect(result.error).toBeUndefined(); expect(result.rows).toEqual([]);
  expect(result.trace.some(row => row.read === "executions")).toBe(false);
});
it.each([{ failRead: true }, { changeSession: true }])("real new API cannot fallback to date scans after a ledger/session failure: %o", async (options) => {
  const old = await legacyBackendScenario(source, { rebound: true });
  const result = await exactMonitorApiScenario(old.record, [old.ledgerRaw], options);
  expect(result.rows).toBeUndefined(); expect(result.error).toBeTruthy();
  expect(result.trace.filter(row => row.action)).toHaveLength(1);
});

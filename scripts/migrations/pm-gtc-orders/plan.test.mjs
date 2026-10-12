import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyGtcCommand, createGtcExecution, gtcCanAuthorizeOther, gtcCanCancel, gtcCanRelease } from "@changmen/shared/pm_gtc";
import { describe, expect, it } from "vitest";
import { CONTROL_COLUMNS, financialProjection, jsonHash, mergePlanReport, planGtcOrdersMerge } from "./plan.mjs";

const owner = "00000000-0000-0000-0000-000000000001";
const otherOwner = "00000000-0000-0000-0000-000000000002";
const executionId = "10000000-0000-0000-0000-000000000001";
const otherExecutionId = "10000000-0000-0000-0000-000000000002";
const hash = `0x${"a".repeat(64)}`;
const plan = { playerId: 11, otherPlayerId: 22, orderHash: hash, originalPmLeg: "A", otherProvider: "RAY", parallel: false, shares: "10", targetShares: "10", price: "0.6", maxPrincipal: "6", allInBudget: "6", fx: 7, linkId: -1000, match: "A - B", bet: "独赢", item: "A", tokenId: "token", conditionId: "condition", otherTarget: "Away", target: "Home", otherOdds: 2, otherStake: 30, matchId: 1, betRowId: 2, otherVenueMatchId: "ray-match", otherVenueItemId: "ray-item", protocol: 3, negRisk: false, route: "route" };
const created = () => createGtcExecution(executionId, owner, "wallet", "maker", structuredClone(plan), 1000);
const source = (record = created()) => ({ id: record.id, owner: record.owner, wallet_key: record.walletKey, active: !record.released, record, updated_at: "2000" });
function financial(changes = {}) {
  return { id: "9007199254740993", user_id: owner, player_id: "11", order_id: hash, link: -1000, provider: "Polymarket", match: "A - B", bet: "独赢", item: "A", odds: 1.6666666667, bet_money: 42, money: -6.73, status: "None", create_at: 1000, raw: { pmGtcExecutionId: executionId, pmSide: "buy", pmGtcBuyShares: 10, pmGtcBuyCost: 6, pmSellProceeds: 0.5, pmAttributedSellShares: 1, pmMatchResult: "win", positionEvents: { sells: [{ id: "sell", shares: "1", proceeds: "0.5" }] } }, ...changes };
}
function snapshot(executions = [source()], orders = []) {
  return { schemaVersion: 1, complete: true, snapshot: { isolation: "repeatable-read", token: "local-test-fixture", tables: ["orders", "pm_gtc_executions", "profiles"] }, profiles: [{ id: owner }, { id: otherOwner }], executions, orders };
}
const conflictCodes = value => planGtcOrdersMerge(value).conflicts.map(conflict => conflict.code);
function materialize(result) {
  return result.projectedOrders.map((row, index) => row.id ? row : { ...row, id: String(index + 100) });
}

describe("gTC and execution control merge preflight", () => {
  it("stores a full prepared control record on the signed original while keeping the financial collection empty", () => {
    const input = snapshot();
    const before = JSON.stringify(input);
    const result = planGtcOrdersMerge(input);
    expect(result.preflightPassed).toBe(true);
    expect(result.counts).toEqual({ "attach-control": 0, "insert-pending": 1, "noop": 0 });
    const row = result.projectedOrders[0];
    expect(row.order_id).toBe(hash);
    expect(row.execution_record).toEqual(input.executions[0].record);
    expect(row.financial_ready).toBe(false);
    expect(row.raw).toEqual({});
    expect(row.odds).toBe(0);
    expect(financialProjection(result.projectedOrders)).toEqual([]);
    expect(JSON.stringify(input)).toBe(before);
    expect(result.databaseSnapshotVerified).toBe(false);
    expect(result.databaseBackfillReady).toBe(false);
  });

  it("attaches all control columns to an existing financial original without rewriting its ID, raw or financial fields", () => {
    const original = financial();
    const result = planGtcOrdersMerge(snapshot([source()], [original]));
    expect(result.preflightPassed).toBe(true);
    expect(result.counts["attach-control"]).toBe(1);
    expect(result.projectedOrders[0].id).toBe("9007199254740993");
    expect(result.projectedOrders[0].raw).toEqual(original.raw);
    expect(financialProjection(result.projectedOrders)).toEqual([original]);
    expect(result.operations[0].expectedTargetHash).toBe(jsonHash(original));
  });

  it("preserves unknown legacy fields, null fees, FAILED fills and all cancellation and authorization evidence verbatim", () => {
    const record = { ...created(), pmAuthorized: true, submit: "unknown", revision: 17, deadlineAt: 12000, counted: true, other: { state: "unknown", orderId: "other-order", submittedAt: 2100, message: "late" }, fee: null, cancel: { commandId: "cancel", state: "unknown", message: "网络异常" }, released: false, releaseRevision: 15, fills: { failed: { key: "failed", tradeId: "trade", bucket: "maker", shares: "2", price: "0.6000000000001", fee: null, status: "FAILED", updatedAt: 1234 } }, legacyExtra: { value: "  不归一化内部空白  ", revision: 9 }, financialOrder: { pmShares: 0, betMoney: 0 } };
    const result = planGtcOrdersMerge(snapshot([source(record)]));
    expect(result.preflightPassed).toBe(true);
    expect(result.projectedOrders[0].execution_record).toEqual(record);
    expect(result.operations[0].controlRecordHash).toBe(jsonHash(record));
    expect(result.projectedOrders[0].execution_record).not.toBe(record);
  });

  it("keeps the counterpart venue and all FOK/other accounts in the original business projection", () => {
    const rows = [financial(), financial({ id: "2", player_id: "22", provider: "RAY", order_id: "ray-original" }), financial({ id: "3", player_id: "33", order_id: "fok-original", raw: {} }), financial({ id: "4", user_id: otherOwner, raw: {} })];
    const result = planGtcOrdersMerge(snapshot([source()], rows));
    expect(result.preflightPassed).toBe(true);
    expect(financialProjection(result.projectedOrders)).toEqual(rows);
    expect(result.projectedOrders.slice(1)).toEqual(rows.slice(1));
  });

  it("keeps released control, late counterpart identity and count markers even when no financial original remains", () => {
    const record = { ...created(), revision: 31, released: true, releaseRevision: 30, counted: true, decision: "closed", pmAuthorized: true, submit: "accepted", orderId: hash, other: { state: "pending", orderId: "ray-order", submittedAt: 2000, message: "待结" } };
    const ray = financial({ id: "1", player_id: "22", order_id: "ray-order", provider: "RAY", raw: { pmGtcExecutionId: executionId } });
    const result = planGtcOrdersMerge(snapshot([source(record)], [ray]));
    expect(result.preflightPassed).toBe(true);
    const original = result.projectedOrders[1];
    expect(original.execution_active).toBe(false);
    expect(original.execution_record).toEqual(record);
    expect(original.financial_ready).toBe(false);
    expect(financialProjection(result.projectedOrders)).toEqual([ray]);
  });

  it("permits multiple originals on one wallet and never merges by Link, wallet or counterpart", () => {
    const second = { ...created(), id: otherExecutionId, plan: { ...plan, orderHash: `0x${"b".repeat(64)}` } };
    const result = planGtcOrdersMerge(snapshot([source(), source(second)]));
    expect(result.preflightPassed).toBe(true);
    expect(result.projectedOrders).toHaveLength(2);
    expect(result.projectedOrders.map(row => row.execution_id)).toEqual([executionId, otherExecutionId]);
  });

  it("uses exact owner/player/original identity and allows only case differences in a signed hash", () => {
    const row = financial({ order_id: hash.toUpperCase() });
    const result = planGtcOrdersMerge(snapshot([source()], [row]));
    expect(result.counts["attach-control"]).toBe(1);
    expect(result.projectedOrders[0].order_id).toBe(row.order_id);
  });

  it("is idempotent for a fully identical migrated pending row", () => {
    const input = snapshot();
    const first = planGtcOrdersMerge(input);
    const repeated = planGtcOrdersMerge({ ...input, orders: materialize(first) });
    expect(repeated.preflightPassed).toBe(true);
    expect(repeated.counts).toEqual({ "attach-control": 0, "insert-pending": 0, "noop": 1 });
    expect(repeated.financialRowsAfter).toBe(0);
  });

  it("is idempotent for existing financial rows without losing sell/settlement facts", () => {
    const input = snapshot([source()], [financial()]);
    const first = planGtcOrdersMerge(input);
    const repeated = planGtcOrdersMerge({ ...input, orders: first.projectedOrders });
    expect(repeated.preflightPassed).toBe(true);
    expect(repeated.counts.noop).toBe(1);
    expect(financialProjection(repeated.projectedOrders)).toEqual(input.orders);
  });

  it.each([
    ["complete snapshot", value => value.complete = false],
    ["single consistent transaction", value => value.snapshot.isolation = "read-committed"],
    ["all three tables", value => value.snapshot.tables.pop()],
    ["known version", value => value.schemaVersion = 2],
    ["nonempty snapshot token", value => value.snapshot.token = ""],
    ["lossless bigint identity", value => value.orders = [financial({ id: 9007199254740992 })]],
    ["unique primary key", value => value.orders = [financial(), financial()]],
    ["JSON-only values", value => value.executions[0].record.legacy = undefined],
  ])("rejects missing or malformed %s", (_name, modify) => {
    const input = snapshot(); modify(input);
    expect(() => planGtcOrdersMerge(input)).toThrow();
  });

  it.each([
    ["MALFORMED_SOURCE", value => value.executions[0].id = "bad-id"],
    ["MALFORMED_SOURCE", value => value.executions[0] = null],
    ["OWNER_PROFILE_MISSING", value => value.profiles = [{ id: otherOwner }]],
    ["INCOMPLETE_CONTROL_RECORD", value => delete value.executions[0].record.pmAuthorized],
    ["SOURCE_CONTROL_IDENTITY_MISMATCH", value => value.executions[0].record.owner = otherOwner],
    ["SOURCE_CONTROL_IDENTITY_MISMATCH", value => value.executions[0].record.id = otherExecutionId],
    ["SOURCE_CONTROL_IDENTITY_MISMATCH", value => value.executions[0].record.walletKey = "other-wallet"],
    ["MALFORMED_CONTROL_IDENTITY", value => value.executions[0].record.revision = -1],
    ["MALFORMED_CONTROL_IDENTITY", value => value.executions[0].record.plan.playerId = Number.MAX_SAFE_INTEGER + 1],
    ["MALFORMED_CONTROL_RECORD", value => value.executions[0].record.released = "false"],
    ["ACTIVE_STATE_MISMATCH", value => value.executions[0].active = false],
    ["ORIGINAL_ORDER_ID_MISMATCH", value => value.executions[0].record.orderId = `0x${"b".repeat(64)}`],
    ["DUPLICATE_EXECUTION_ID", value => value.executions.push(structuredClone(value.executions[0]))],
    ["MULTIPLE_EXECUTIONS_FOR_ORIGINAL", value => value.executions.push(source({ ...created(), id: otherExecutionId }))],
    ["AMBIGUOUS_CASE_FOLDED_ORIGINAL", value => value.orders = [financial(), financial({ id: "2", order_id: hash.toUpperCase() })]],
    ["TARGET_IS_NOT_PM_ORIGINAL_BUY", value => value.orders = [financial({ provider: "RAY" })]],
    ["TARGET_IS_NOT_PM_ORIGINAL_BUY", value => value.orders = [financial({ raw: { pmSide: "sell" } })]],
    ["TARGET_EXECUTION_IDENTITY_CONFLICT", value => value.orders = [financial({ raw: { pmGtcExecutionId: otherExecutionId } })]],
    ["EXECUTION_BOUND_TO_DIFFERENT_ORDER", value => value.orders = [financial({ player_id: "22", execution_id: executionId })]],
    ["TARGET_CONTROL_HAS_NO_SOURCE", value => value.orders = [financial({ execution_id: otherExecutionId })]],
    ["ORPHAN_NONFINANCIAL_ROW", value => value.orders = [financial({ financial_ready: false })]],
  ])("blocks %s without repairing state or financial data", (code, modify) => {
    const input = snapshot(); modify(input);
    const before = JSON.stringify(input);
    const result = planGtcOrdersMerge(input);
    expect(result.preflightPassed).toBe(false);
    expect(result.conflicts.map(conflict => conflict.code)).toContain(code);
    expect(JSON.stringify(input)).toBe(before);
    expect(result.financialProjectionUnchanged).toBe(true);
  });

  it.each(["execution_record", "execution_wallet_key", "execution_active", "execution_updated_at", "execution_kind"])("rejects drift in target %s", (key) => {
    const input = snapshot();
    const first = planGtcOrdersMerge(input);
    const row = materialize(first)[0];
    row[key] = key === "execution_record" ? { ...row[key], revision: 42 } : key === "execution_active" ? false : "changed";
    expect(conflictCodes({ ...input, orders: [row] })).toContain("TARGET_CONTROL_CHANGED");
  });

  it("rejects a newer target revision rather than resetting or replaying it", () => {
    const input = snapshot();
    const row = materialize(planGtcOrdersMerge(input))[0];
    row.execution_record.revision = 2;
    row.execution_record.pmAuthorized = true;
    expect(conflictCodes({ ...input, orders: [row] })).toContain("TARGET_CONTROL_CHANGED");
    expect(row.execution_record.pmAuthorized).toBe(true);
  });

  it("requires explicit financial readiness for an already migrated control row", () => {
    const input = snapshot();
    const row = materialize(planGtcOrdersMerge(input))[0];
    delete row.financial_ready;
    expect(conflictCodes({ ...input, orders: [row] })).toContain("TARGET_READINESS_MISSING");
  });

  it("never attaches a source to another player's or owner's exact same venue hash", () => {
    const others = [financial({ id: "1", user_id: otherOwner }), financial({ id: "2", player_id: "22" })];
    const result = planGtcOrdersMerge(snapshot([source()], others));
    expect(result.preflightPassed).toBe(true);
    expect(result.counts["insert-pending"]).toBe(1);
    expect(result.projectedOrders.slice(0, 2)).toEqual(others);
  });

  it("jSONB object key order does not cause false differences, but string contents do", () => {
    expect(jsonHash({ b: 1, a: "x" })).toBe(jsonHash({ a: "x", b: 1 }));
    expect(jsonHash({ a: " x " })).not.toBe(jsonHash({ a: "x" }));
  });

  it("summary reports hashes and identities without leaking full control payloads", () => {
    const result = planGtcOrdersMerge(snapshot());
    const report = mergePlanReport(result);
    expect(report.applied).toBe(false);
    expect(report).not.toHaveProperty("projectedOrders");
    for (const operation of report.operations) {
      expect(operation).not.toHaveProperty("control");
      expect(operation).not.toHaveProperty("row");
    }
    expect(JSON.stringify(report)).not.toContain("execution_record");
    expect(JSON.stringify(report)).not.toContain("wallet");
  });
});

describe("original command behavior with the migrated control record", () => {
  const authorized = () => applyGtcCommand(created(), { kind: "authorize_pm" }, 2000);
  const accepted = () => applyGtcCommand(authorized(), { kind: "ack", state: "accepted", orderId: hash }, 2100);
  const matched = () => ({ ...accepted(), matched: "10", principal: "6", fee: "0", complete: true, error: "", open: "0", terminal: true });
  const outcome = (record, command, time) => {
    try { return { result: applyGtcCommand(record, command, time) }; }
    catch (error) { return { error: error.message }; }
  };
  it.each([
    ["first PM authorization", created, { kind: "authorize_pm" }, 2000],
    ["duplicate PM authorization", authorized, { kind: "authorize_pm" }, 2100],
    ["unknown PM receipt", authorized, { kind: "ack", state: "unknown", message: "timeout" }, 2100],
    ["PM reject", authorized, { kind: "ack", state: "rejected", message: "reject" }, 2100],
    ["accepted original", authorized, { kind: "ack", state: "accepted", orderId: hash }, 2100],
    ["other leg before fill", accepted, { kind: "authorize_other" }, 2200],
    ["other leg before deadline", matched, { kind: "authorize_other" }, 11999],
    ["other leg at deadline", matched, { kind: "authorize_other" }, 12000],
    ["other leg after deadline", matched, { kind: "authorize_other" }, 12001],
    ["close/recovery state", accepted, { kind: "close" }, 13000],
    ["count marker", matched, { kind: "counted" }, 13000],
    ["manual has no second leg", () => ({ ...matched(), plan: { ...plan, source: "manual" } }), { kind: "authorize_other" }, 2200],
  ])("preserves %s using the actual existing state machine", (_name, make, command, time) => {
    const old = make();
    const migrated = planGtcOrdersMerge(snapshot([source(old)])).projectedOrders[0].execution_record;
    expect(outcome(migrated, command, time)).toEqual(outcome(old, command, time));
    expect(gtcCanAuthorizeOther(migrated, time)).toBe(gtcCanAuthorizeOther(old, time));
    expect(gtcCanCancel(migrated)).toBe(gtcCanCancel(old));
    expect(gtcCanRelease(migrated)).toBe(gtcCanRelease(old));
  });
});

describe("offline CLI controls", () => {
  const script = path.resolve("scripts/migrations/pm-gtc-orders/audit.mjs");
  function run(args) {
    return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 10000, env: { ...process.env, DATABASE_URL: "postgres://must-not-connect.invalid/test", DATABASE_URL_PUBLIC: "postgres://must-not-connect.invalid/test" } });
  }
  function localFiles(callback) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gtc-orders-merge-"));
    try { callback(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  it("rejects --apply before reading an input or connecting anywhere", () => {
    const result = run(["--apply", "--input", "missing.json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("apply is unavailable");
  });
  it("audits a fixture offline and refuses to overwrite either input or existing report", () => localFiles((dir) => {
    const input = path.join(dir, "input.json"); const output = path.join(dir, "report.json");
    fs.writeFileSync(input, JSON.stringify(snapshot()));
    const original = fs.readFileSync(input, "utf8");
    const result = run(["--input", input, "--output", output]);
    expect(result.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toMatchObject({ offline: true, applied: false, preflightPassed: true });
    expect(run(["--input", input, "--output", output]).status).toBe(1);
    expect(run(["--input", input, "--output", input]).status).toBe(1);
    expect(fs.readFileSync(input, "utf8")).toBe(original);
  }));
  it("returns exit 2 and a reviewable report for identity conflicts", () => localFiles((dir) => {
    const input = path.join(dir, "input.json");
    fs.writeFileSync(input, JSON.stringify(snapshot([source()], [financial({ raw: { pmGtcExecutionId: otherExecutionId } })])));
    const result = run(["--input", input]);
    expect(result.status).toBe(2);
    const report = JSON.parse(result.stdout);
    expect(report.preflightPassed).toBe(false);
    expect(report.conflicts[0].code).toBe("TARGET_EXECUTION_IDENTITY_CONFLICT");
  }));
  it("returns exit 1 for an incomplete snapshot", () => localFiles((dir) => {
    const input = path.join(dir, "input.json");
    fs.writeFileSync(input, JSON.stringify({ ...snapshot(), complete: false }));
    expect(run(["--input", input]).status).toBe(1);
  }));
  it("protects the immutable list of complete control columns", () => {
    expect(CONTROL_COLUMNS).toEqual(["execution_kind", "execution_id", "execution_wallet_key", "execution_active", "execution_record", "execution_updated_at"]);
  });
});

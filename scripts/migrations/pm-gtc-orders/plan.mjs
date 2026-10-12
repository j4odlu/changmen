// [changmen 扩展] 并表阶段一：纯离线预检。未接入业务入口，不执行 SQL 或状态命令。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const CONTROL_KIND = "pm-gtc-v1";
export const CONTROL_COLUMNS = ["execution_kind", "execution_id", "execution_wallet_key", "execution_active", "execution_record", "execution_updated_at"];
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const orderHash = /^0x[\da-f]{64}$/i;
const object = value => value != null && typeof value === "object" && !Array.isArray(value);
const lower = value => String(value).toLowerCase();
function positiveId(value) {
  return (typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value)))
    && /^[1-9]\d*$/.test(String(value)) && BigInt(value) <= 9223372036854775807n;
}
const requiredRecordFields = ["id", "owner", "walletKey", "maker", "plan", "createdAt", "revision", "submit", "orderId", "decision", "deadlineAt", "pmAuthorized", "other", "manual", "released", "cancel", "fills", "order", "matched", "principal", "fee", "open", "terminal", "complete", "groupComplete", "observedAt", "error", "counted"];

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    assert(Number.isFinite(value), "snapshot contains a non-finite number");
    return value;
  }
  if (Array.isArray(value))
    return value.map(canonical);
  assert(object(value) && Object.getPrototypeOf(value) === Object.prototype, "snapshot must contain only JSON values");
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

export const jsonHash = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

/** 只用于迁移预检：原订单没有标记时仍属于原财务集合。 */
export function financialProjection(orders) {
  return orders.filter(row => row.financial_ready !== false).map(row =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !CONTROL_COLUMNS.includes(key) && key !== "financial_ready")));
}

function validateSnapshot(snapshot) {
  jsonHash(snapshot);
  assert.equal(snapshot.schemaVersion, 1, "unsupported snapshot schema");
  assert.equal(snapshot.complete, true, "a complete snapshot is required; partial owner/date exports are forbidden");
  assert.equal(snapshot.snapshot?.isolation, "repeatable-read", "orders, executions and profiles must share one repeatable-read snapshot");
  assert.equal(typeof snapshot.snapshot.token, "string");
  assert(snapshot.snapshot.token.length > 0, "snapshot token is missing");
  assert.deepEqual([...snapshot.snapshot.tables].sort(), ["orders", "pm_gtc_executions", "profiles"]);
  for (const key of ["profiles", "executions", "orders"])
    assert(Array.isArray(snapshot[key]), `${key} must be an array`);
  const profiles = new Set();
  for (const profile of snapshot.profiles) {
    assert(object(profile) && uuid.test(profile.id), "invalid profile identity");
    assert(!profiles.has(lower(profile.id)), "duplicate profile identity");
    profiles.add(lower(profile.id));
  }
  const rowIds = new Set();
  for (const row of snapshot.orders) {
    assert(object(row) && positiveId(row.id) && uuid.test(row.user_id) && positiveId(row.player_id)
      && typeof row.order_id === "string" && row.order_id.length > 0, "invalid order identity");
    assert(!rowIds.has(String(row.id)), "duplicate orders primary key");
    rowIds.add(String(row.id));
    assert(row.financial_ready == null || typeof row.financial_ready === "boolean", "invalid financial_ready");
  }
  return profiles;
}

function sourceIssue(source, profiles) {
  if (!object(source))
    return "MALFORMED_SOURCE";
  const record = source.record;
  if (!uuid.test(source.id) || !uuid.test(source.owner) || typeof source.wallet_key !== "string" || !source.wallet_key
    || typeof source.active !== "boolean" || !positiveId(source.updated_at) || !object(record)) {
    return "MALFORMED_SOURCE";
  }
  if (!profiles.has(lower(source.owner)))
    return "OWNER_PROFILE_MISSING";
  if (requiredRecordFields.some(key => !Object.hasOwn(record, key)))
    return "INCOMPLETE_CONTROL_RECORD";
  if (!uuid.test(record.id) || !uuid.test(record.owner) || lower(record.id) !== lower(source.id)
    || lower(record.owner) !== lower(source.owner) || record.walletKey !== source.wallet_key) {
    return "SOURCE_CONTROL_IDENTITY_MISMATCH";
  }
  if (!Number.isSafeInteger(record.revision) || record.revision < 0 || !Number.isSafeInteger(record.createdAt) || record.createdAt <= 0
    || !object(record.plan) || !Number.isSafeInteger(record.plan.playerId) || record.plan.playerId <= 0
    || typeof record.plan.orderHash !== "string" || !orderHash.test(record.plan.orderHash)) {
    return "MALFORMED_CONTROL_IDENTITY";
  }
  if (["pmAuthorized", "manual", "released", "terminal", "complete", "groupComplete", "counted"].some(key => typeof record[key] !== "boolean")
    || !object(record.other) || !object(record.fills)) {
    return "MALFORMED_CONTROL_RECORD";
  }
  if (source.active !== !record.released)
    return "ACTIVE_STATE_MISMATCH";
  // 原 ack 已要求原单 ID 等于签单 hash；并表不借机修订、改键或猜测身份。
  if (record.orderId != null && (typeof record.orderId !== "string" || lower(record.orderId) !== lower(record.plan.orderHash)))
    return "ORIGINAL_ORDER_ID_MISMATCH";
}

function sameControl(target, control) {
  return target.execution_kind === control.execution_kind
    && lower(target.execution_id) === lower(control.execution_id)
    && target.execution_wallet_key === control.execution_wallet_key
    && target.execution_active === control.execution_active
    && String(target.execution_updated_at) === String(control.execution_updated_at)
    && object(target.execution_record) && jsonHash(target.execution_record) === jsonHash(control.execution_record);
}

function originalKey(owner, playerId, originalId) {
  return `${lower(owner)}:${playerId}:${lower(originalId)}`;
}

function pendingRow(source, control) {
  const record = source.record;
  const plan = record.plan;
  return {
    user_id: source.owner,
    player_id: String(plan.playerId),
    order_id: record.orderId ?? plan.orderHash,
    link: plan.linkId ?? null,
    provider: "Polymarket",
    match: plan.match ?? null,
    bet: plan.bet ?? null,
    item: plan.item ?? null,
    // 仅满足现有非空列；financial_ready=false 明确表示这些默认值不是核实财务事实。
    odds: 0,
    bet_money: 0,
    money: 0,
    status: "None",
    create_at: record.createdAt,
    raw: {},
    financial_ready: false,
    ...control,
  };
}

/** 完整复制执行 record；禁止重建授权、重算状态、按 Link/钱包合并或覆盖财务字段。 */
export function planGtcOrdersMerge(snapshot) {
  const profiles = validateSnapshot(snapshot);
  const operations = [];
  const conflicts = [];
  const sources = new Map();
  const sourceTargets = new Map();
  const controlOwners = new Map();
  const originalOrders = new Map();
  const rowIndexes = new Map();
  const projected = structuredClone(snapshot.orders);
  const conflict = (id, code, rowIds = []) => conflicts.push({ executionId: String(id), code, rowIds: rowIds.map(String) });
  for (const source of snapshot.executions) {
    const issue = sourceIssue(source, profiles);
    if (issue) {
      conflict(source?.id, issue);
      continue;
    }
    const id = lower(source.id);
    if (sources.has(id)) {
      conflict(source.id, "DUPLICATE_EXECUTION_ID");
      continue;
    }
    sources.set(id, source);
    const key = originalKey(source.owner, source.record.plan.playerId, source.record.plan.orderHash);
    const group = sourceTargets.get(key) ?? [];
    group.push(source);
    sourceTargets.set(key, group);
  }
  for (const [index, row] of snapshot.orders.entries()) {
    rowIndexes.set(row, index);
    const key = originalKey(row.user_id, row.player_id, row.order_id);
    const originals = originalOrders.get(key) ?? [];
    originals.push(row);
    originalOrders.set(key, originals);
    if (row.financial_ready === false && !CONTROL_COLUMNS.some(key => row[key] != null))
      conflict(`order:${row.id}`, "ORPHAN_NONFINANCIAL_ROW", [row.id]);
    if (row.execution_id != null) {
      const group = controlOwners.get(lower(row.execution_id)) ?? [];
      group.push(row);
      controlOwners.set(lower(row.execution_id), group);
    }
  }
  for (const group of sourceTargets.values()) {
    if (group.length > 1) {
      for (const source of group)
        conflict(source.id, "MULTIPLE_EXECUTIONS_FOR_ORIGINAL");
      continue;
    }
    const source = group[0];
    const { record } = source;
    const candidates = originalOrders.get(originalKey(source.owner, record.plan.playerId, record.plan.orderHash)) ?? [];
    if (candidates.length > 1) {
      conflict(source.id, "AMBIGUOUS_CASE_FOLDED_ORIGINAL", candidates.map(row => row.id));
      continue;
    }
    const target = candidates[0];
    const bound = controlOwners.get(lower(source.id)) ?? [];
    if (bound.length > 1 || (bound.length === 1 && bound[0] !== target)) {
      conflict(source.id, "EXECUTION_BOUND_TO_DIFFERENT_ORDER", bound.map(row => row.id));
      continue;
    }
    if (target && (target.provider !== "Polymarket" || lower(target.raw?.pmSide ?? "buy") === "sell")) {
      conflict(source.id, "TARGET_IS_NOT_PM_ORIGINAL_BUY", [target.id]);
      continue;
    }
    if (target && ((target.execution_id != null && lower(target.execution_id) !== lower(source.id))
      || (target.raw?.pmGtcExecutionId != null && lower(target.raw.pmGtcExecutionId) !== lower(source.id)))) {
      conflict(source.id, "TARGET_EXECUTION_IDENTITY_CONFLICT", [target.id]);
      continue;
    }
    const control = {
      execution_kind: CONTROL_KIND,
      execution_id: source.id,
      execution_wallet_key: source.wallet_key,
      execution_active: source.active,
      execution_record: structuredClone(record),
      execution_updated_at: source.updated_at,
    };
    if (target && CONTROL_COLUMNS.some(key => target[key] != null)) {
      if (typeof target.financial_ready !== "boolean") {
        conflict(source.id, "TARGET_READINESS_MISSING", [target.id]);
        continue;
      }
      if (!sameControl(target, control)) {
        conflict(source.id, "TARGET_CONTROL_CHANGED", [target.id]);
        continue;
      }
      operations.push({ action: "noop", executionId: source.id, targetId: String(target.id), sourceHash: jsonHash(source), controlRecordHash: jsonHash(record) });
      continue;
    }
    const common = { executionId: source.id, sourceHash: jsonHash(source), controlRecordHash: jsonHash(record), control };
    if (target) {
      const result = { ...target, financial_ready: target.financial_ready ?? true, ...control };
      projected[rowIndexes.get(target)] = result;
      operations.push({ ...common, action: "attach-control", targetId: String(target.id), expectedTargetHash: jsonHash(target) });
    }
    else {
      const row = pendingRow(source, control);
      projected.push(row);
      operations.push({ ...common, action: "insert-pending", row });
    }
  }
  // 不能忽略目标中已存在、但本次完整旧表快照没有的控制记录。
  for (const [id, rows] of controlOwners) {
    if (!sources.has(id))
      conflict(id, "TARGET_CONTROL_HAS_NO_SOURCE", rows.map(row => row.id));
  }
  const before = financialProjection(snapshot.orders);
  const after = financialProjection(projected);
  assert.deepEqual(after, before, "the migration plan changed existing financial/business rows");
  operations.sort((a, b) => a.executionId.localeCompare(b.executionId));
  conflicts.sort((a, b) => a.executionId.localeCompare(b.executionId) || a.code.localeCompare(b.code));
  return {
    schemaVersion: 1,
    offline: true,
    databaseSnapshotVerified: false,
    databaseBackfillReady: false,
    preflightPassed: conflicts.length === 0 && operations.length === snapshot.executions.length,
    snapshotToken: snapshot.snapshot.token,
    snapshotHash: jsonHash(snapshot),
    sourceCount: snapshot.executions.length,
    counts: Object.fromEntries(["attach-control", "insert-pending", "noop"].map(action => [action, operations.filter(operation => operation.action === action).length])),
    financialRowsBefore: before.length,
    financialRowsAfter: after.length,
    financialProjectionHash: jsonHash(before),
    financialProjectionUnchanged: true,
    operations,
    conflicts,
    projectedOrders: projected,
  };
}

/** CLI 报告仅输出身份、哈希和冲突，不输出钱包、计划、成交明细或完整 record。 */
export function mergePlanReport(plan) {
  const { operations, projectedOrders: _projected, ...summary } = plan;
  return {
    ...summary,
    applied: false,
    operations: operations.map(({ action, executionId, targetId, sourceHash, controlRecordHash, expectedTargetHash }) => ({
      action,
      executionId,
      ...(targetId ? { targetId } : {}),
      sourceHash,
      controlRecordHash,
      ...(expectedTargetHash ? { expectedTargetHash } : {}),
    })),
  };
}

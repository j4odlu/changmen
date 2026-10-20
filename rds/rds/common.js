/**
 * RDS 公共工具 — pool 访问、fire-and-forget 写入、jsonb 序列化。
 * rds/*_store 均经此 getPgPool() 取连接池。
 *
 * 写队列满队列策略（W1 第一版）：
 * - 同 opts.key：队列内 coalesce，只留最新（含已满时）→ 计入 coalesced，不丢最新
 * - 无法 coalesce：仍 drop 本次 → 计入 dropped + 醒目日志（不做踢最旧）
 */

import { getDbMode } from "../db_script.js";
import { getPgPool as getSharedPgPool } from "../pg_pool.js";

const _mode = getDbMode();
const _writeQueue = [];
let _activeWrites = 0;
const _activeWriteKeys = new Set();
let _droppedWrites = 0;
let _coalescedWrites = 0;
/** @type {Map<string, number>} 按 label 统计 drop 次数，供 /health/diag 归因「在丢哪类写」 */
const _droppedByLabel = new Map();

/** @type {number|null} */
let _queueMaxOverride = null;
/** @type {number|null} */
let _concurrencyOverride = null;

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const WRITE_CONCURRENCY = envInt("RDS_WRITE_CONCURRENCY", 3);
const WRITE_QUEUE_MAX = envInt("RDS_WRITE_QUEUE_MAX", 2000);

function writeQueueMax() {
  return _queueMaxOverride ?? WRITE_QUEUE_MAX;
}

function writeConcurrency() {
  return _concurrencyOverride ?? WRITE_CONCURRENCY;
}

export function getPgPool() {
  return getSharedPgPool(`GAMEBET_DB_SCRIPT=${_mode.script}`);
}

export function jsonb(val, fallback) {
  if (val == null)
    return JSON.stringify(fallback ?? null);
  return JSON.stringify(val);
}

/** impl_rds 内部沿用旧名 */
export const _jsonb = jsonb;

function _logDrop({ label, key, reason, labelDropped }) {
  const tag = label ? `:${label}` : "";
  const keyNote = key ? ` key=${key}` : "";
  const labelNote = labelDropped != null ? ` label_dropped=${labelDropped}` : "";
  // error 级：写丢失是数据风险，须在日志聚合中可被告警，而非淹没在 warn 里
  console.error(
    `[rds${tag}] write queue full (${reason}), dropped=${_droppedWrites}${labelNote}`
    + `${keyNote}, pending=${_writeQueue.length}, max=${writeQueueMax()}`
    + " — 同 key 会 coalesce；持续 dropped 请扩 RDS_WRITE_QUEUE_MAX 或查慢写",
  );
}

/**
 * @param {{ fn: Function, label: string, pool: object, key: string }} item
 */
function _offerWrite(item) {
  const key = item.key || "";

  // 同 key：无论是否已满，队列内只留最新（in-flight 不在队列里，随后仍会再跑本条）
  if (key) {
    const existing = _writeQueue.findIndex(q => q.key === key);
    if (existing >= 0) {
      _writeQueue[existing] = item;
      _coalescedWrites += 1;
      _drainWriteQueue();
      return;
    }
  }

  if (_writeQueue.length >= writeQueueMax()) {
    _droppedWrites += 1;
    const labelKey = item.label || "(no-label)";
    const labelDropped = (_droppedByLabel.get(labelKey) || 0) + 1;
    _droppedByLabel.set(labelKey, labelDropped);
    if (_droppedWrites === 1 || _droppedWrites % 50 === 0) {
      _logDrop({
        label: item.label,
        key,
        reason: key ? "no pending twin to coalesce" : "no key",
        labelDropped,
      });
    }
    return;
  }

  _writeQueue.push(item);
  _drainWriteQueue();
}

/** fire-and-forget 写入 RDS */
export function _writeRds(fn, label = "", opts = {}) {
  const pool = getPgPool();
  if (!pool)
    return;
  _offerWrite({
    fn,
    label,
    pool,
    key: opts.key ? String(opts.key) : "",
  });
}

function _nextWriteIndex() {
  return _writeQueue.findIndex(item => !item.key || !_activeWriteKeys.has(item.key));
}

function _drainWriteQueue() {
  while (_activeWrites < writeConcurrency() && _writeQueue.length) {
    const idx = _nextWriteIndex();
    if (idx < 0)
      return;
    const [item] = _writeQueue.splice(idx, 1);
    _activeWrites += 1;
    if (item.key)
      _activeWriteKeys.add(item.key);
    Promise.resolve()
      .then(() => item.fn(item.pool))
      .catch(err => console.warn(`[rds${item.label ? `:${item.label}` : ""}]`, err.message))
      .finally(() => {
        _activeWrites -= 1;
        if (item.key)
          _activeWriteKeys.delete(item.key);
        _drainWriteQueue();
      });
  }
}

export async function _writeRdsAsync(fn, label = "") {
  const pool = getPgPool();
  if (!pool)
    return;
  try {
    await fn(pool);
  }
  catch (err) {
    console.warn(`[rds${label ? `:${label}` : ""}]`, err.message);
    throw err;
  }
}

/** /health/diag：RDS 异步写队列深度（排查 closure 堆积） */
export function getRdsWriteQueueStats() {
  return {
    pending: _writeQueue.length,
    active: _activeWrites,
    activeKeys: _activeWriteKeys.size,
    dropped: _droppedWrites,
    droppedByLabel: Object.fromEntries(_droppedByLabel),
    coalesced: _coalescedWrites,
    max: writeQueueMax(),
    concurrency: writeConcurrency(),
  };
}

/**
 * @internal 测试用：重置队列与计数；可覆写 max/concurrency（concurrency=0 可冻结 drain）
 * @param {{ queueMax?: number, concurrency?: number }} [opts]
 */
export function __resetRdsWriteQueueForTests(opts = {}) {
  _writeQueue.length = 0;
  _activeWrites = 0;
  _activeWriteKeys.clear();
  _droppedWrites = 0;
  _coalescedWrites = 0;
  _droppedByLabel.clear();
  _queueMaxOverride = opts.queueMax != null ? opts.queueMax : null;
  _concurrencyOverride = opts.concurrency != null ? opts.concurrency : null;
}

/**
 * @internal 测试用：绕过 getPgPool，直接入队
 * @param {{ fn: Function, label?: string, pool?: object, key?: string }} item
 */
export function __offerRdsWriteForTests(item) {
  _offerWrite({
    fn: item.fn,
    label: item.label || "",
    pool: item.pool || {},
    key: item.key ? String(item.key) : "",
  });
}

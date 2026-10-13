import { minimalFinancialDeletionSql } from "./pm_orders_minimal.js";
import { DELETE_FINANCIAL_ORDERS_SQL, financialDeletionIds, financialOrdersHookRow, financialOrdersRelation, ordersExecutionCompatibilityEnabled, ordinaryOrdersUpsertSql } from "./orders_execution_compat.js";
/**
 * orders 表读写 — upsert、查询、管理端、SaveOrderBind。
 */

import {
  VALUE_BET_LINK_BASE,
  canRebindLinkNewerToOlder,
  shouldAllowOrderBind,
  shouldFireOrderBoundHook,
  sqlOrderBelongsToRange,
} from "../order_link_filter.js";
import { Currency, getExchange } from "@changmen/shared/currency";
import { _jsonb, getPgPool } from "./common.js";
import { localDayBounds, localMonthBounds } from "./time_bounds.js";

/**
 * 聚合用 CNY 盈亏 SQL（对齐 profit_cny / 前端 polymarketMoneyForAggregate）。
 * @param {string} alias 表别名，如 "" / "o" / "a"
 * @param {string} fxParam 汇率占位符，如 "$3"
 */
function sqlOrderMoneyCny(alias, fxParam) {
  const p = alias ? `${alias}.` : "";
  return `CASE
    WHEN ${p}provider = 'Polymarket' AND LOWER(COALESCE(${p}raw->>'pmSide', '')) = 'sell' THEN 0
    WHEN ${p}provider = 'PredictFun' AND LOWER(COALESCE(${p}raw->>'pfSide', '')) = 'sell' THEN 0
    WHEN ${p}provider = 'PredictFun' THEN COALESCE(${p}money, 0) * ${fxParam}
    ELSE COALESCE(${p}money, 0)
  END`;
}

/** PF bet_money 为 USDT → CNY */
function sqlOrderBetCny(alias, fxParam) {
  const p = alias ? `${alias}.` : "";
  return `CASE
    WHEN ${p}provider = 'PredictFun' THEN COALESCE(${p}bet_money, 0) * ${fxParam}
    ELSE COALESCE(${p}bet_money, 0)
  END`;
}

/** 与 hasOpenPolymarketPosition / PM_SHARE_DUST 对齐 */
const PM_SHARE_DUST = 0.01;

/** PM/PF 卖单影子行（盈亏记在买单，数据分析不计订单数） */
function sqlIsPredictionSell(alias = "") {
  const p = alias ? `${alias}.` : "";
  return `(
    (${p}provider = 'Polymarket' AND LOWER(COALESCE(${p}raw->>'pmSide', '')) = 'sell')
    OR (${p}provider = 'PredictFun' AND LOWER(COALESCE(${p}raw->>'pfSide', '')) = 'sell')
  )`;
}

/**
 * 已卖光的预测市场买单（盈亏已在卖出路径，status 常仍为 None）。
 * 对齐 hasOpenPolymarketPosition：closed/settled 或剩余份额≤尘量。
 */
function sqlPredictionBuyClosed(alias = "") {
  const p = alias ? `${alias}.` : "";
  const shares = `COALESCE(NULLIF(${p}raw->>'pmShares', ''), '0')::float8`;
  const attr = `COALESCE(NULLIF(${p}raw->>'pmAttributedSellShares', ''), '0')::float8`;
  return `(
    (
      ${p}provider = 'Polymarket'
      AND LOWER(COALESCE(${p}raw->>'pmSide', '')) IS DISTINCT FROM 'sell'
      AND (
        LOWER(COALESCE(${p}raw->>'pmSellState', '')) IN ('closed', 'settled')
        OR (${attr} > 0 AND (${shares} - ${attr}) <= ${PM_SHARE_DUST})
      )
    )
    OR (
      ${p}provider = 'PredictFun'
      AND LOWER(COALESCE(${p}raw->>'pfSide', '')) IS DISTINCT FROM 'sell'
      AND LOWER(COALESCE(${p}raw->>'pfSellState', '')) IN ('closed', 'settled')
    )
  )`;
}

/** 数据分析 Pending：未平仓未结，不含卖单、不含已卖光买单 */
function sqlAnalyticsPending(alias = "") {
  const p = alias ? `${alias}.` : "";
  return `(${p}status = 'None'
    AND NOT ${sqlIsPredictionSell(alias)}
    AND NOT ${sqlPredictionBuyClosed(alias)})`;
}

const UPSERT_ORDERS_BATCH_SQL = `
  INSERT INTO orders (
    user_id, player_id, order_id, link, provider, match, bet, item,
    odds, bet_money, money, status, create_at, raw
  )
  SELECT * FROM unnest(
    $1::uuid[],
    $2::bigint[],
    $3::text[],
    $4::bigint[],
    $5::text[],
    $6::text[],
    $7::text[],
    $8::text[],
    $9::float8[],
    $10::float8[],
    $11::float8[],
    $12::text[],
    $13::bigint[],
    $14::jsonb[]
  ) AS t(
    user_id, player_id, order_id, link, provider, match, bet, item,
    odds, bet_money, money, status, create_at, raw
  )
  ON CONFLICT (user_id, order_id, player_id) DO UPDATE SET
    link = EXCLUDED.link,
    provider = EXCLUDED.provider,
    match = EXCLUDED.match,
    bet = EXCLUDED.bet,
    item = EXCLUDED.item,
    odds = EXCLUDED.odds,
    bet_money = EXCLUDED.bet_money,
    money = EXCLUDED.money,
    status = EXCLUDED.status,
    create_at = EXCLUDED.create_at,
    raw = EXCLUDED.raw
  RETURNING *, (xmax = 0) AS was_inserted
`;

function _orderRowToUpsertArrays(rows) {
  const userIds = [];
  const playerIds = [];
  const orderIds = [];
  const links = [];
  const providers = [];
  const matches = [];
  const bets = [];
  const items = [];
  const oddsList = [];
  const betMoneys = [];
  const moneys = [];
  const statuses = [];
  const createAts = [];
  const raws = [];
  for (const o of rows) {
    userIds.push(String(o.user_id));
    playerIds.push(Number(o.player_id));
    orderIds.push(String(o.order_id));
    links.push(o.link != null ? Number(o.link) : null);
    providers.push(o.provider != null ? String(o.provider) : null);
    matches.push(o.match != null ? String(o.match) : null);
    bets.push(o.bet != null ? String(o.bet) : null);
    items.push(o.item != null ? String(o.item) : null);
    oddsList.push(Number(o.odds) || 0);
    betMoneys.push(Number(o.bet_money) || 0);
    moneys.push(Number(o.money) || 0);
    statuses.push(String(o.status || "None"));
    createAts.push(Number(o.create_at));
    raws.push(JSON.parse(_jsonb(o.raw, {})));
  }
  return [
    userIds,
    playerIds,
    orderIds,
    links,
    providers,
    matches,
    bets,
    items,
    oddsList,
    betMoneys,
    moneys,
    statuses,
    createAts,
    raws,
  ];
}

function _dedupeUpsertRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.user_id}\0${row.player_id}\0${row.order_id}`;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

async function _rdsUpsertOrders(pool, rows) {
  if (!rows?.length)
    return [];
  const deduped = _dedupeUpsertRows(rows);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(ordinaryOrdersUpsertSql(UPSERT_ORDERS_BATCH_SQL), _orderRowToUpsertArrays(deduped));
    await client.query("COMMIT");
    const inserted = [];
    for (const row of res.rows || []) {
      if (row?.was_inserted) {
        const { was_inserted: _wi, ...clean } = row;
        inserted.push(financialOrdersHookRow(clean));
      }
    }
    return inserted;
  }
  catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  finally {
    client.release();
  }
}

/** orders 新行写入后回调（由 backend 注册 Telegram 等） */
let _ordersInsertedHook = null;

export function setOrdersInsertedHook(fn) {
  _ordersInsertedHook = typeof fn === "function" ? fn : null;
}

/** SaveOrderBind 将 link 从外部 hash 改为套利/单边后回调 */
let _ordersBoundHook = null;

export function setOrdersBoundHook(fn) {
  _ordersBoundHook = typeof fn === "function" ? fn : null;
}

/** upsert 订单列表；新插入行经 setOrdersInsertedHook 通知 */
export async function upsertOrders(rows) {
  if (!rows?.length)
    return false;
  const pool = getPgPool();
  if (!pool)
    return false;
  try {
    const inserted = await _rdsUpsertOrders(pool, rows);
    if (inserted.length && _ordersInsertedHook) {
      try {
        _ordersInsertedHook(inserted);
      }
      catch (hookErr) {
        console.warn("[rds] ordersInsertedHook:", hookErr.message);
      }
    }
    return true;
  }
  catch (err) {
    console.warn("[rds] upsertOrders:", err.message);
    return false;
  }
}

/**
 * PredictFun pending_credit → 入账 + 标 credited（同事务，防双付）。
 * 仅当 raw.pfLedgerState === pending_credit 时生效；amount 以库内 pfPendingCreditUsdt 为准。
 * 拒单会顺带写 pfRefundedAt。
 *
 * @returns {{ ok: true, skipped?: boolean, amount: number, total?: number } | { ok: false }}
 */
export async function claimCreditPfPendingOrderRow(playerId, orderId, ownerUserId) {
  const pid = Number(playerId);
  const oid = String(orderId ?? "").trim();
  const uid = ownerUserId != null ? String(ownerUserId).trim() : "";
  if (!Number.isFinite(pid) || pid <= 0 || !oid || !uid)
    return { ok: false };

  const pool = getPgPool();
  if (!pool)
    return { ok: false };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sel = await client.query(
      `SELECT status, raw
       FROM ${financialOrdersRelation()}
       WHERE user_id = $1::uuid AND player_id = $2 AND order_id = $3
       FOR UPDATE`,
      [uid, pid, oid],
    );
    const orderRow = sel.rows?.[0];
    if (!orderRow) {
      await client.query("ROLLBACK");
      return { ok: false };
    }

    const raw = orderRow.raw && typeof orderRow.raw === "object" && !Array.isArray(orderRow.raw)
      ? { ...orderRow.raw }
      : {};
    const ledger = String(raw.pfLedgerState ?? "").trim().toLowerCase();
    if (ledger !== "pending_credit") {
      await client.query("COMMIT");
      return { ok: true, skipped: true, amount: 0 };
    }

    const amount = Math.round((Number(raw.pfPendingCreditUsdt) || 0) * 100) / 100;
    let total;

    if (amount > 0) {
      const cred = await client.query(
        `UPDATE players
         SET total_balance = total_balance + $2, updated_at = $3
         WHERE id = $1 AND deleted_at IS NULL AND owner_user_id = $4::uuid
         RETURNING total_balance`,
        [pid, amount, Date.now(), uid],
      );
      if (!cred.rows?.[0]) {
        await client.query("ROLLBACK");
        return { ok: false };
      }
      total = Math.round((Number(cred.rows[0].total_balance) || 0) * 100) / 100;
    }
    else {
      const bal = await client.query(
        `SELECT total_balance FROM players
         WHERE id = $1 AND deleted_at IS NULL AND owner_user_id = $2::uuid`,
        [pid, uid],
      );
      total = Math.round((Number(bal.rows?.[0]?.total_balance) || 0) * 100) / 100;
    }

    const patch = {
      pfLedgerState: "credited",
      pfPendingCreditUsdt: 0,
    };
    if (String(orderRow.status ?? "").toLowerCase() === "reject")
      patch.pfRefundedAt = Date.now();

    await client.query(
      `UPDATE ${financialOrdersRelation()}
       SET raw = COALESCE(raw, '{}'::jsonb) || $4::jsonb
       WHERE user_id = $1::uuid AND player_id = $2 AND order_id = $3
         AND lower(COALESCE(raw->>'pfLedgerState', '')) = 'pending_credit'`,
      [uid, pid, oid, JSON.stringify(patch)],
    );
    // FOR UPDATE 下应必然命中；若未命中则回滚，避免已入账却仍 pending
    const check = await client.query(
      `SELECT lower(COALESCE(raw->>'pfLedgerState', '')) AS ledger
       FROM ${financialOrdersRelation()}
       WHERE user_id = $1::uuid AND player_id = $2 AND order_id = $3`,
      [uid, pid, oid],
    );
    if (String(check.rows?.[0]?.ledger ?? "") !== "credited") {
      await client.query("ROLLBACK");
      return { ok: false };
    }

    await client.query("COMMIT");
    return { ok: true, amount: amount > 0 ? amount : 0, total };
  }
  catch (err) {
    try {
      await client.query("ROLLBACK");
    }
    catch {
      /* ignore */
    }
    console.warn("[rds] claimCreditPfPendingOrderRow:", err.message);
    return { ok: false };
  }
  finally {
    client.release();
  }
}

/**
 * 卖出迟到 fee：同事务校正买单 proceeds / 卖单 bet_money，并按账本状态调整余额。
 * - 买单仍 pending_credit：只改 pending 金额与 proceeds，不立刻动余额（后续 claim）
 * - 已 credited：按 delta 入账或扣回（不足则回滚）
 * 幂等：买单 pfSellProceeds 已等于 targetProceeds 则 skip。
 *
 * @returns {{ ok: true, skipped?: boolean, mode?: string, amount?: number, total?: number, delta?: number }
 *   | { ok: false }}
 */
export async function adjustPfSellProceedsAfterFeeRow(playerId, ownerUserId, params = {}) {
  const pid = Number(playerId);
  const uid = ownerUserId != null ? String(ownerUserId).trim() : "";
  const buyOrderId = String(params.buyOrderId ?? "").trim();
  const sellOrderId = String(params.sellOrderId ?? "").trim();
  const targetProceeds = Math.round((Number(params.targetProceeds) || 0) * 100) / 100;
  const targetProfit = Math.round((Number(params.targetProfit) || 0) * 100) / 100;
  if (!Number.isFinite(pid) || pid <= 0 || !uid || !buyOrderId || !(targetProceeds >= 0))
    return { ok: false };

  const buyRawExtra = params.buyRawExtra && typeof params.buyRawExtra === "object"
    ? params.buyRawExtra
    : {};
  const sellRawExtra = params.sellRawExtra && typeof params.sellRawExtra === "object"
    ? params.sellRawExtra
    : {};

  const pool = getPgPool();
  if (!pool)
    return { ok: false };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const buySel = await client.query(
      `SELECT order_id, bet_money, money, status, raw
       FROM ${financialOrdersRelation()}
       WHERE user_id = $1::uuid AND player_id = $2 AND order_id = $3
       FOR UPDATE`,
      [uid, pid, buyOrderId],
    );
    const buyRow = buySel.rows?.[0];
    if (!buyRow) {
      await client.query("ROLLBACK");
      return { ok: false };
    }

    const buyRaw = buyRow.raw && typeof buyRow.raw === "object" && !Array.isArray(buyRow.raw)
      ? { ...buyRow.raw }
      : {};
    const currentProceeds = Math.round((Number(buyRaw.pfSellProceeds) || 0) * 100) / 100;
    if (Math.abs(currentProceeds - targetProceeds) < 0.005) {
      await client.query("COMMIT");
      return { ok: true, skipped: true, amount: 0, delta: 0 };
    }

    let sellRow = null;
    if (sellOrderId) {
      const sellSel = await client.query(
        `SELECT order_id, bet_money, money, status, raw
         FROM ${financialOrdersRelation()}
         WHERE user_id = $1::uuid AND player_id = $2 AND order_id = $3
         FOR UPDATE`,
        [uid, pid, sellOrderId],
      );
      sellRow = sellSel.rows?.[0] ?? null;
    }

    const ledger = String(buyRaw.pfLedgerState ?? "").trim().toLowerCase();
    const delta = Math.round((targetProceeds - currentProceeds) * 100) / 100;
    let total;
    let mode = "metadata";

    if (ledger === "pending_credit") {
      mode = "pending_rewrite";
      const bal = await client.query(
        `SELECT total_balance FROM players
         WHERE id = $1 AND deleted_at IS NULL AND owner_user_id = $2::uuid
         FOR UPDATE`,
        [pid, uid],
      );
      if (!bal.rows?.[0]) {
        await client.query("ROLLBACK");
        return { ok: false };
      }
      total = Math.round((Number(bal.rows[0].total_balance) || 0) * 100) / 100;
    }
    else if (delta !== 0) {
      mode = delta > 0 ? "credit_delta" : "debit_delta";
      const adj = Math.abs(delta);
      if (delta > 0) {
        const cred = await client.query(
          `UPDATE players
           SET total_balance = total_balance + $2, updated_at = $3
           WHERE id = $1 AND deleted_at IS NULL AND owner_user_id = $4::uuid
           RETURNING total_balance`,
          [pid, adj, Date.now(), uid],
        );
        if (!cred.rows?.[0]) {
          await client.query("ROLLBACK");
          return { ok: false };
        }
        total = Math.round((Number(cred.rows[0].total_balance) || 0) * 100) / 100;
      }
      else {
        const deb = await client.query(
          `UPDATE players
           SET total_balance = total_balance - $2, updated_at = $3
           WHERE id = $1 AND deleted_at IS NULL AND owner_user_id = $4::uuid
             AND total_balance >= $2
           RETURNING total_balance`,
          [pid, adj, Date.now(), uid],
        );
        if (!deb.rows?.[0]) {
          await client.query("ROLLBACK");
          return { ok: false };
        }
        total = Math.round((Number(deb.rows[0].total_balance) || 0) * 100) / 100;
      }
    }
    else {
      const bal = await client.query(
        `SELECT total_balance FROM players
         WHERE id = $1 AND deleted_at IS NULL AND owner_user_id = $2::uuid`,
        [pid, uid],
      );
      total = Math.round((Number(bal.rows?.[0]?.total_balance) || 0) * 100) / 100;
    }

    const nextBuyRaw = {
      ...buyRaw,
      ...buyRawExtra,
      pfSellProceeds: targetProceeds,
      pfSellFeeAdjustedAt: Date.now(),
    };
    if (ledger === "pending_credit") {
      nextBuyRaw.pfLedgerState = "pending_credit";
      nextBuyRaw.pfPendingCreditUsdt = targetProceeds > 0 ? targetProceeds : 0;
    }
    // Phase 1：迟到 fee 校正时同步仓位事件里对应 sell 的 proceeds/pnl
    const pePrev = buyRaw.positionEvents && typeof buyRaw.positionEvents === "object"
      && !Array.isArray(buyRaw.positionEvents)
      ? buyRaw.positionEvents
      : null;
    if (pePrev && Array.isArray(pePrev.sells) && pePrev.sells.length) {
      const sellKey = sellOrderId.toLowerCase();
      const nextSells = pePrev.sells.map((ev) => {
        if (!ev || typeof ev !== "object")
          return ev;
        const id = String(ev.id ?? ev.orderId ?? "").trim().toLowerCase();
        const match = sellKey
          ? id === sellKey
          : pePrev.sells.length === 1;
        if (!match)
          return ev;
        return {
          ...ev,
          proceeds: targetProceeds,
          pnl: targetProfit,
          status: ev.status === "closing" ? "closed" : (ev.status || "closed"),
        };
      });
      nextBuyRaw.positionEvents = { ...pePrev, sells: nextSells };
    }

    await client.query(
      `UPDATE ${financialOrdersRelation()}
       SET money = $4,
           raw = COALESCE(raw, '{}'::jsonb) || $5::jsonb
       WHERE user_id = $1::uuid AND player_id = $2 AND order_id = $3`,
      [uid, pid, buyOrderId, targetProfit, JSON.stringify(nextBuyRaw)],
    );

    if (sellRow) {
      const sellRaw = sellRow.raw && typeof sellRow.raw === "object" && !Array.isArray(sellRow.raw)
        ? { ...sellRow.raw }
        : {};
      const nextSellRaw = {
        ...sellRaw,
        ...sellRawExtra,
        pfSellFeeAdjustedAt: Date.now(),
      };
      await client.query(
        `UPDATE ${financialOrdersRelation()}
         SET bet_money = $4,
             money = 0,
             raw = COALESCE(raw, '{}'::jsonb) || $5::jsonb
         WHERE user_id = $1::uuid AND player_id = $2 AND order_id = $3`,
        [uid, pid, sellOrderId, targetProceeds, JSON.stringify(nextSellRaw)],
      );
    }

    await client.query("COMMIT");
    return {
      ok: true,
      mode,
      amount: Math.abs(delta),
      delta,
      total,
    };
  }
  catch (err) {
    try {
      await client.query("ROLLBACK");
    }
    catch {
      /* ignore */
    }
    console.warn("[rds] adjustPfSellProceedsAfterFeeRow:", err.message);
    return { ok: false };
  }
  finally {
    client.release();
  }
}

/** 按日期读取订单（全量，不做 changmen_bet / link 筛选） */
export async function fetchOrdersByDate(date, userId) {
  const { dayStart, dayEnd } = localDayBounds(date);
  const pool = getPgPool();
  if (!pool || !userId)
    return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${financialOrdersRelation()}
       WHERE user_id = $1 AND ${sqlOrderBelongsToRange(2, 3)}
       ORDER BY create_at DESC`,
      [String(userId), dayStart, dayEnd],
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchOrdersByDate:", err.message);
    return [];
  }
}

/** Client_GetOrderList：SQL 分页，避免拉取当日全量再在内存 slice */
export async function fetchOrdersByDatePage(date, userId, pageIndex = 1, pageSize = 1024) {
  const { dayStart, dayEnd } = localDayBounds(date);
  const pool = getPgPool();
  if (!pool || !userId)
    return { rows: [], total: 0 };
  const page = Math.max(1, Number(pageIndex) || 1);
  const size = Math.max(1, Math.min(Number(pageSize) || 1024, 5000));
  const offset = (page - 1) * size;
  try {
    const params = [String(userId), dayStart, dayEnd];
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS n FROM ${financialOrdersRelation()}
       WHERE user_id = $1 AND ${sqlOrderBelongsToRange(2, 3)}`,
      params,
    );
    const total = countRes.rows[0]?.n ?? 0;
    params.push(size, offset);
    const { rows } = await pool.query(
      `SELECT * FROM ${financialOrdersRelation()}
       WHERE user_id = $1 AND ${sqlOrderBelongsToRange(2, 3)}
       ORDER BY create_at DESC
       LIMIT $4 OFFSET $5`,
      params,
    );
    return { rows: rows || [], total };
  }
  catch (err) {
    console.warn("[rds] fetchOrdersByDatePage:", err.message);
    return { rows: [], total: 0 };
  }
}

/**
 * 按 playerId 读取订单。
 * @param {{ sinceCreateAt?: number }} [opts]
 *   sinceCreateAt>0 时：[changmen 扩展] 只返回窗口内订单，并额外保留
 *   Polymarket 仍有可卖剩余份额的买单（对齐 hasOpenPolymarketPosition / PM_SHARE_DUST=0.01）。
 *   省略则全量（MoneyRiskView / A8 Client_GetPlayerOrder）。
 * strict：查询失败向上抛（供 PF 结算/入账等写路径 fail-closed）。
 * 无 pool / 无 userId → `[]`（正常语义，非失败）。
 */
export async function fetchOrdersByPlayerStrict(playerId, userId, opts = undefined) {
  const pool = getPgPool();
  if (!pool || !userId)
    return [];
  const since = Number(opts?.sinceCreateAt);
  const useSince = Number.isFinite(since) && since > 0;
  const { rows } = await pool.query(
    useSince
      ? `SELECT * FROM ${financialOrdersRelation()}
         WHERE user_id = $1 AND player_id = $2
           AND (
             create_at >= $3
             OR (
               provider ILIKE 'Polymarket'
               AND coalesce(raw->>'pmSide', '') IS DISTINCT FROM 'sell'
               AND coalesce(raw->>'pmSellState', '') NOT IN ('closed', 'settled')
               AND lower(coalesce(status, '')) NOT IN ('reject', 'return', 'pending')
               AND (
                 coalesce(nullif(raw->>'pmShares', ''), '0')::float8
                 - coalesce(nullif(raw->>'pmAttributedSellShares', ''), '0')::float8
               ) > 0.01
             )
           )
         ORDER BY create_at DESC`
      : `SELECT * FROM ${financialOrdersRelation()}
         WHERE user_id = $1 AND player_id = $2
         ORDER BY create_at DESC`,
    useSince
      ? [String(userId), Number(playerId), since]
      : [String(userId), Number(playerId)],
  );
  return rows || [];
}

/**
 * @param {{ sinceCreateAt?: number }} [opts]
 * lenient：失败吞成 `[]`（展示/统计）；写路径请用 Strict。
 */
export async function fetchOrdersByPlayer(playerId, userId, opts = undefined) {
  try {
    return await fetchOrdersByPlayerStrict(playerId, userId, opts);
  }
  catch (err) {
    console.warn("[rds] fetchOrdersByPlayer:", err.message);
    return [];
  }
}

/** saveOrder 读已有行（不过滤，含 A8 被动 sync） */
export async function fetchOrdersByPlayerAll(playerId, userId) {
  const pool = getPgPool();
  if (!pool || !userId)
    return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${financialOrdersRelation()} WHERE user_id = $1 AND player_id = $2 ORDER BY create_at DESC`,
      [String(userId), Number(playerId)],
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchOrdersByPlayerAll:", err.message);
    return [];
  }
}

/** saveOrder 合并：只读本次 upsert 涉及的 order_id（及 PM/PF 关联买单；大小写不敏感） */
/**
 * strict 版：按 order_id 批量取该 player 既有订单（合并基线用）。
 * 查询失败 **向上抛**（供 saveOrder 等"读既有→合并覆盖"路径中止，勿把失败当"无既有单"→当新单覆盖账本）。
 * 无 pool / 无效入参 / ids 去重后为空 → `[]`（正常语义）；真正无行 → `[]`。
 */
export async function fetchOrdersByPlayerOrderIdsStrict(playerId, userId, orderIds) {
  const pool = getPgPool();
  if (!pool || !userId || !Array.isArray(orderIds) || !orderIds.length)
    return [];
  const ids = [...new Set(
    orderIds.map(id => String(id).trim().toLowerCase()).filter(Boolean),
  )];
  if (!ids.length)
    return [];
  const { rows } = await pool.query(
    `SELECT * FROM ${financialOrdersRelation()}
     WHERE user_id = $1 AND player_id = $2 AND lower(order_id) = ANY($3::text[])`,
    [String(userId), Number(playerId), ids],
  );
  return rows || [];
}

/** lenient：失败吞成 `[]`（仅运维/展示用；写合并路径请用 strict 版） */
export async function fetchOrdersByPlayerOrderIds(playerId, userId, orderIds) {
  try {
    return await fetchOrdersByPlayerOrderIdsStrict(playerId, userId, orderIds);
  }
  catch (err) {
    console.warn("[rds] fetchOrdersByPlayerOrderIds:", err.message);
    return [];
  }
}

/** 运维：同 Link 订单 */
export async function fetchOrdersByLink(userId, link) {
  const pool = getPgPool();
  const uid = String(userId || "").trim();
  const linkVal = Number(link);
  if (!pool || !uid || !Number.isFinite(linkVal) || linkVal === 0)
    return [];
  try {
    const { rows } = await pool.query(
      `SELECT order_id, user_id, player_id, link, provider, match, bet, item,
              odds, bet_money, money, status, create_at
       FROM ${financialOrdersRelation()} WHERE user_id = $1 AND link = $2
       ORDER BY create_at ASC`,
      [uid, linkVal],
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchOrdersByLink:", err.message);
    return [];
  }
}

/**
 * [changmen 扩展] 按多个 Link 拉全量订单（含跨日）。
 * 用于侧栏按日列表并入同 Link 的买卖腿，避免「昨天买今天卖」拆组。
 */
export async function fetchOrdersByLinks(userId, links) {
  const pool = getPgPool();
  const uid = String(userId || "").trim();
  if (!pool || !uid || !Array.isArray(links) || !links.length)
    return [];
  const linkVals = [...new Set(
    links.map(l => Number(l)).filter(n => Number.isFinite(n) && n !== 0),
  )];
  if (!linkVals.length)
    return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ${financialOrdersRelation()}
       WHERE user_id = $1 AND link = ANY($2::bigint[])
       ORDER BY create_at DESC`,
      [uid, linkVals],
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchOrdersByLinks:", err.message);
    return [];
  }
}

/**
 * [changmen 扩展] 按 order_id 批量拉单（跨日父买单；大小写不敏感）。
 * @param {string} userId
 * @param {string[]} orderIds
 * @param {string[]|null} [userIds] 管理端多用户时可选缩小范围
 */
export async function fetchOrdersByUserOrderIds(userId, orderIds, userIds = null) {
  const pool = getPgPool();
  const ids = [...new Set(
    (orderIds || []).map(id => String(id ?? "").trim().toLowerCase()).filter(Boolean),
  )];
  if (!pool || !ids.length)
    return [];
  try {
    const params = [ids];
    let where = `lower(order_id) = ANY($1::text[])`;
    const uid = String(userId || "").trim();
    if (uid) {
      params.push(uid);
      where += ` AND user_id = $${params.length}`;
    }
    else if (Array.isArray(userIds) && userIds.length) {
      params.push(userIds.map(String));
      where += ` AND user_id = ANY($${params.length}::uuid[])`;
    }
    const { rows } = await pool.query(
      `SELECT * FROM ${financialOrdersRelation()} WHERE ${where} ORDER BY create_at DESC`,
      params,
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchOrdersByUserOrderIds:", err.message);
    return [];
  }
}

/**
 * [changmen 扩展] 按父买单 order_id 拉 PM/PF 卖单（不依赖 sell.link）。
 * @param {string} userId
 * @param {string[]} buyOrderIds
 * @param {string[]|null} [userIds]
 */
export async function fetchPredictionSellsByBuyOrderIds(userId, buyOrderIds, userIds = null) {
  const pool = getPgPool();
  const ids = [...new Set(
    (buyOrderIds || []).map(id => String(id ?? "").trim().toLowerCase()).filter(Boolean),
  )];
  if (!pool || !ids.length)
    return [];
  try {
    const params = [ids];
    let where = `(
      lower(COALESCE(raw->>'pmBuyOrderId', '')) = ANY($1::text[])
      OR lower(COALESCE(raw->>'pfBuyOrderId', '')) = ANY($1::text[])
    )`;
    const uid = String(userId || "").trim();
    if (uid) {
      params.push(uid);
      where += ` AND user_id = $${params.length}`;
    }
    else if (Array.isArray(userIds) && userIds.length) {
      params.push(userIds.map(String));
      where += ` AND user_id = ANY($${params.length}::uuid[])`;
    }
    const { rows } = await pool.query(
      `SELECT * FROM ${financialOrdersRelation()} WHERE ${where} ORDER BY create_at DESC`,
      params,
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchPredictionSellsByBuyOrderIds:", err.message);
    return [];
  }
}

/** 按 order_id 查单行 */
export async function fetchOrderByOrderId(userId, orderId) {
  const pool = getPgPool();
  const uid = String(userId || "").trim();
  const oid = String(orderId || "").trim();
  if (!pool || !uid || !oid)
    return null;
  try {
    const { rows } = await pool.query(
      `SELECT order_id, user_id, player_id, link, provider, match, bet, item,
              odds, bet_money, money, status, create_at
       FROM ${financialOrdersRelation()} WHERE user_id = $1 AND order_id = $2
       LIMIT 1`,
      [uid, oid],
    );
    return rows?.[0] ?? null;
  }
  catch (err) {
    console.warn("[rds] fetchOrderByOrderId:", err.message);
    return null;
  }
}

export async function fetchUserByName(userName) {
  const pool = getPgPool();
  const name = String(userName || "").trim();
  if (!pool || !name)
    return null;
  try {
    const { rows } = await pool.query(
      `SELECT id, user_name FROM users WHERE lower(user_name) = lower($1) LIMIT 1`,
      [name],
    );
    return rows?.[0] ?? null;
  }
  catch (err) {
    console.warn("[rds] fetchUserByName:", err.message);
    return null;
  }
}

export async function fetchUserById(userId) {
  const pool = getPgPool();
  const uid = String(userId || "").trim();
  if (!pool || !uid)
    return null;
  try {
    const { rows } = await pool.query(
      `SELECT id, user_name FROM users WHERE id = $1 LIMIT 1`,
      [uid],
    );
    return rows?.[0] ?? null;
  }
  catch (err) {
    console.warn("[rds] fetchUserById:", err.message);
    return null;
  }
}

/** 管理端：当日订单汇总（笔数不计 PM/PF 卖单；PF 盈亏/流水 USDT→CNY） */
export async function fetchOrdersAdminStats(dateKey) {
  const { dayStart, dayEnd } = localDayBounds(dateKey);
  const pool = getPgPool();
  if (!pool)
    return { count: 0, money: 0, betMoney: 0 };
  try {
    const { rows } = await pool.query(
      `SELECT money, bet_money, status, provider, raw FROM ${financialOrdersRelation()} WHERE ${sqlOrderBelongsToRange(1, 2)}`,
      [dayStart, dayEnd],
    );
    const fx = getExchange(Currency.USDT);
    let count = 0;
    let money = 0;
    let betMoney = 0;
    for (const o of rows || []) {
      if (String(o.status || "") === "Reject")
        continue;
      const raw = o.raw && typeof o.raw === "object" ? o.raw : {};
      if (String(raw.domain || "").trim().toLowerCase() === "sports")
        continue;
      const provider = String(o.provider || "").trim();
      const isPf = provider === "PredictFun";
      const isSell = (provider === "Polymarket" && String(raw.pmSide || "").toLowerCase() === "sell")
        || (isPf && String(raw.pfSide || "").toLowerCase() === "sell");
      // PM/PF 买单 money；卖单盈亏记买单，此处 money 计 0。PF 买单 USDT→CNY
      const rawMoney = Number(o.money) || 0;
      money += isSell
        ? 0
        : (isPf ? rawMoney * fx : rawMoney);
      if (!isSell) {
        count += 1;
        const rawBet = Number(o.bet_money) || 0;
        betMoney += isPf ? rawBet * fx : rawBet;
      }
    }
    return { count, money, betMoney };
  }
  catch (err) {
    console.warn("[rds] fetchOrdersAdminStats:", err.message);
    return { count: 0, money: 0, betMoney: 0 };
  }
}

/** 管理端：分页订单 */
export async function fetchOrdersAdminPage({
  dateKey,
  userId,
  provider,
  playerId,
  pageIndex,
  pageSize,
  userIds,
}) {
  const { dayStart, dayEnd } = localDayBounds(dateKey);
  const from = (Math.max(1, pageIndex) - 1) * pageSize;
  const pool = getPgPool();
  if (!pool)
    return { rows: [], total: 0 };
  try {
    const params = [dayStart, dayEnd];
    let where = sqlOrderBelongsToRange(1, 2);
    if (userId) {
      params.push(String(userId));
      where += ` AND user_id = $${params.length}`;
    }
    else if (Array.isArray(userIds) && userIds.length) {
      params.push(userIds);
      where += ` AND user_id = ANY($${params.length}::uuid[])`;
    }
    if (provider) {
      params.push(String(provider));
      where += ` AND provider = $${params.length}`;
    }
    const pid = Number(playerId);
    if (Number.isFinite(pid) && pid > 0) {
      params.push(pid);
      where += ` AND player_id = $${params.length}`;
    }
    const countRes = await pool.query(`SELECT COUNT(*)::int AS n FROM ${financialOrdersRelation()} WHERE ${where}`, params);
    const total = countRes.rows[0]?.n ?? 0;
    params.push(pageSize, from);
    const { rows } = await pool.query(
      `SELECT * FROM ${financialOrdersRelation()} WHERE ${where} ORDER BY create_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { rows: rows || [], total };
  }
  catch (err) {
    console.warn("[rds] fetchOrdersAdminPage:", err.message);
    return { rows: [], total: 0 };
  }
}

/** 管理端足球订单：统一 orders 内的非 OB 体育足球订单。OB 足球仍走 football_orders。 */
export async function fetchUnifiedFootballOrdersAdmin({ dateKey, userId, limit = 2000 } = {}) {
  const { dayStart, dayEnd } = localDayBounds(dateKey);
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const params = [dayStart, dayEnd];
    let where = `${sqlOrderBelongsToRange(1, 2)}
      AND LOWER(COALESCE(raw->>'domain', '')) = 'sports'
      AND LOWER(COALESCE(raw->>'sport', raw->>'game', '')) = 'football'
      AND UPPER(COALESCE(provider, '')) <> 'OB'`;
    if (userId) {
      params.push(String(userId));
      where += ` AND user_id = $${params.length}::uuid`;
    }
    params.push(Math.min(Math.max(Number(limit) || 2000, 1), 5000));
    const { rows } = await pool.query(
      `SELECT o.*, p.user_name
       FROM ${financialOrdersRelation("o")}
       LEFT JOIN profiles p ON p.id = o.user_id
       WHERE ${where}
       ORDER BY o.create_at DESC, o.id DESC
       LIMIT $${params.length}`,
      params,
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchUnifiedFootballOrdersAdmin:", err.message);
    return [];
  }
}

/** 管理端：按主键 id 删除订单 */
export async function deleteOrdersByIds(ids) {
  if (!Array.isArray(ids) || !ids.length)
    return 0;
  const pool = getPgPool();
  if (!pool)
    return 0;
  const clean = ordersExecutionCompatibilityEnabled() ? financialDeletionIds(ids) : ids
    .map(id => Number(id))
    .filter(n => Number.isFinite(n) && n > 0);
  if (!clean.length)
    return 0;
  try {
    const res = await pool.query(ordersExecutionCompatibilityEnabled() ? minimalFinancialDeletionSql(DELETE_FINANCIAL_ORDERS_SQL) : "DELETE FROM orders WHERE id = ANY($1::bigint[])", [clean]);
    return res.rowCount ?? 0;
  }
  catch (err) {
    console.warn("[rds] deleteOrdersByIds:", err.message);
    return 0;
  }
}

/**
 * 删除 Polymarket 卖单（仅 raw.pmSide = 'sell'，避免误删买单）。
 * @param {{ userId?: string, playerId?: number }} scope 可选范围
 */
export async function deletePolymarketSellOrders(scope = {}) {
  const pool = getPgPool();
  if (!pool)
    return { deleted: 0, ids: [] };
  try {
    const params = [];
    let where = `provider = 'Polymarket' AND raw->>'pmSide' = 'sell'`;
    const userId = scope.userId != null ? String(scope.userId).trim() : "";
    const playerId = Number(scope.playerId);
    if (userId) {
      params.push(userId);
      where += ` AND user_id = $${params.length}::uuid`;
    }
    if (Number.isFinite(playerId) && playerId > 0) {
      params.push(playerId);
      where += ` AND player_id = $${params.length}`;
    }
    const res = await pool.query(
      `DELETE FROM ${financialOrdersRelation()} WHERE ${where} RETURNING id`,
      params,
    );
    const ids = (res.rows || []).map(r => Number(r.id)).filter(n => Number.isFinite(n) && n > 0);
    return { deleted: res.rowCount ?? 0, ids };
  }
  catch (err) {
    console.warn("[rds] deletePolymarketSellOrders:", err.message);
    return { deleted: 0, ids: [] };
  }
}

/** 管理端：当日全量订单（对阵矩阵，上限 5000 条） */
export async function fetchOrdersAdminAll({ dateKey, provider, limit = 5000, userIds }) {
  const { dayStart, dayEnd } = localDayBounds(dateKey);
  const cap = Math.min(5000, Math.max(1, Number(limit) || 5000));
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const params = [dayStart, dayEnd];
    let where = sqlOrderBelongsToRange(1, 2);
    if (Array.isArray(userIds) && userIds.length) {
      params.push(userIds);
      where += ` AND user_id = ANY($${params.length}::uuid[])`;
    }
    if (provider) {
      params.push(String(provider));
      where += ` AND provider = $${params.length}`;
    }
    params.push(cap);
    const { rows } = await pool.query(
      `SELECT * FROM ${financialOrdersRelation()} WHERE ${where} ORDER BY create_at ASC LIMIT $${params.length}`,
      params,
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchOrdersAdminAll:", err.message);
    return [];
  }
}

/** 月报：读取指定月份订单聚合字段；可选 user_id 筛选 */
export async function fetchOrdersForMonthAggregate(monthKey, userId, userIds) {
  const { monthStart, monthEnd } = localMonthBounds(monthKey);
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const params = [monthStart, monthEnd];
    let sql = `SELECT id, user_id, order_id, link, create_at, money, bet_money, status, provider, raw
               FROM ${financialOrdersRelation()} WHERE ${sqlOrderBelongsToRange(1, 2)}`;
    if (userId) {
      params.push(String(userId));
      sql += ` AND user_id = $${params.length}`;
    }
    else if (Array.isArray(userIds) && userIds.length) {
      params.push(userIds);
      sql += ` AND user_id = ANY($${params.length}::uuid[])`;
    }
    const { rows } = await pool.query(sql, params);
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchOrdersForMonthAggregate:", err.message);
    return [];
  }
}

/** 排行榜：按本地自然日读取订单盈利聚合字段 */
export async function fetchOrdersForProfitAggregate(dateKey) {
  const { dayStart, dayEnd } = localDayBounds(dateKey);
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, user_id, player_id, order_id, link, create_at, money, bet_money, status, provider, raw
       FROM ${financialOrdersRelation()} WHERE ${sqlOrderBelongsToRange(1, 2)}`,
      [dayStart, dayEnd],
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchOrdersForProfitAggregate:", err.message);
    return [];
  }
}

/**
 * 更新订单 link 绑定。
 * 内部 SELECT 不过滤 link（需匹配占位行后再写 bind link）。
 */
function buildOrderBindMatch(userId, orderId, opts = {}) {
  const playerId = Number(opts.playerId);
  const provider = opts.provider ? String(opts.provider) : "";
  const params = [String(userId), String(orderId)];
  const parts = ["user_id = $1", "order_id = $2"];
  if (Number.isFinite(playerId) && playerId > 0) {
    params.push(playerId);
    parts.push(`player_id = $${params.length}`);
  }
  else if (provider) {
    params.push(provider);
    parts.push(`provider = $${params.length}`);
  }
  return { where: parts.join(" AND "), params };
}

/** UPDATE SET link = $1 时，WHERE 占位符整体 +1 */
function offsetSqlPlaceholders(clause, offset) {
  return clause.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
}

export async function updateOrderBind(orderId, userId, link, opts = {}) {
  if (!orderId || !userId)
    return false;
  const linkVal = Number(link) || 0;
  const pool = getPgPool();
  if (!pool)
    return false;
  try {
    const { where, params } = buildOrderBindMatch(userId, orderId, opts);
    const sel = await pool.query(`SELECT * FROM ${financialOrdersRelation()} WHERE ${where}`, params);
    const prev = sel.rows?.[0];
    if (!prev)
      return false;
    if (!shouldAllowOrderBind(prev, linkVal)) {
      console.warn(
        "[rds] updateOrderBind: refused cross-arb rebind",
        `| orderId=${orderId} prevLink=${prev.link} nextLink=${linkVal} create_at=${prev.create_at}`,
      );
      return false;
    }
    const updateWhere = offsetSqlPlaceholders(where, 1);
    const res = await pool.query(
      `UPDATE ${financialOrdersRelation()} SET link = $1 WHERE ${updateWhere}`,
      [linkVal, ...params],
    );
    if (res.rowCount > 0 && shouldFireOrderBoundHook(prev, linkVal) && _ordersBoundHook) {
      try {
        _ordersBoundHook([{ ...prev, link: linkVal }]);
      }
      catch (hookErr) {
        console.warn("[rds] ordersBoundHook:", hookErr.message);
      }
    }
    return res.rowCount > 0;
  }
  catch (err) {
    console.warn(
      "[rds] updateOrderBind:",
      err.message,
      `| orderId=${orderId} userId=${userId} link=${link} linkVal=${linkVal}`,
      `| opts=${JSON.stringify(opts)}`,
    );
    return false;
  }
}

/**
 * [changmen 扩展] 用户侧栏手动改绑：单笔 order 的 link 改为 toLink（仅新→老）。
 * 不走 shouldAllowOrderBind。
 * @returns {{ ok: boolean, msg?: string, orderId?: string, fromLinkId?: number, toLinkId?: number }}
 */
export async function rebindOrderLink(userId, orderId, toLinkId) {
  const uid = String(userId || "").trim();
  const oid = String(orderId || "").trim();
  const toLink = Number(toLinkId);
  if (!uid || !oid)
    return { ok: false, msg: "orderId 必填" };
  if (!Number.isFinite(toLink) || toLink === 0)
    return { ok: false, msg: "toLinkId 无效" };

  const pool = getPgPool();
  if (!pool)
    return { ok: false, msg: "数据库不可用" };

  try {
    const prev = await fetchOrderByOrderId(uid, oid);
    if (!prev)
      return { ok: false, msg: "订单不存在" };

    const fromLink = Number(prev.link) || 0;
    if (fromLink === toLink)
      return { ok: true, orderId: oid, fromLinkId: fromLink, toLinkId: toLink };

    if (!canRebindLinkNewerToOlder(fromLink, toLink)) {
      return {
        ok: false,
        msg: "只能把较新的 Link 并入较老的 Link",
        orderId: oid,
        fromLinkId: fromLink,
        toLinkId: toLink,
      };
    }

    const peers = await fetchOrdersByLink(uid, toLink);
    if (!peers.length) {
      return {
        ok: false,
        msg: "目标 Link 下没有本用户订单",
        orderId: oid,
        fromLinkId: fromLink,
        toLinkId: toLink,
      };
    }

    const res = await pool.query(
      `UPDATE ${financialOrdersRelation()} SET link = $1 WHERE user_id = $2 AND order_id = $3`,
      [toLink, uid, oid],
    );
    if (!(res.rowCount > 0))
      return { ok: false, msg: "更新失败", orderId: oid, fromLinkId: fromLink, toLinkId: toLink };

    console.info(
      "[rds] rebindOrderLink:",
      `| userId=${uid} orderId=${oid} from=${fromLink} to=${toLink}`,
    );
    return { ok: true, orderId: oid, fromLinkId: fromLink, toLinkId: toLink };
  }
  catch (err) {
    console.warn("[rds] rebindOrderLink:", err.message, `| orderId=${oid} to=${toLink}`);
    return { ok: false, msg: err.message || "改绑失败" };
  }
}

function appendUserIdsFilter(params, userIds) {
  if (!Array.isArray(userIds) || !userIds.length)
    return "";
  params.push(userIds);
  return ` AND user_id = ANY($${params.length}::uuid[])`;
}

/**
 * 套利分析共用 CTE：剔 PM/PF 卖单 + 每 (user, abs(link), provider) 一笔买单。
 * 依赖 params：$1=startMs，$2=endMs。
 * @param {string} userFilterOnO 已带 AND 的过滤，列须写成 o.user_id
 */
function sqlArbUniqCtes(userFilterOnO = "") {
  return `legs AS (
        SELECT o.*
        FROM ${financialOrdersRelation("o")}
        WHERE ABS(o.link) >= 1000000000000
          AND o.create_at >= $1 AND o.create_at < $2
          AND o.provider IS NOT NULL AND o.provider != ''
          AND NOT ${sqlIsPredictionSell("o")}
          ${userFilterOnO}
      ),
      ranked AS (
        SELECT legs.*,
          ROW_NUMBER() OVER (
            PARTITION BY legs.user_id, ABS(legs.link), legs.provider
            ORDER BY
              CASE WHEN legs.status = 'Reject' THEN 1 ELSE 0 END ASC,
              legs.create_at DESC,
              legs.id DESC
          ) AS rn
        FROM legs
      ),
      uniq AS (
        SELECT * FROM ranked WHERE rn = 1
      )`;
}

/** 数据分析：按平台聚合盈亏统计（剔 PM/PF 卖单；Pending 不含已卖光买单） */
export async function fetchPlatformAnalytics(startMs, endMs, userIds) {
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const fx = getExchange(Currency.USDT);
    const params = [startMs, endMs, fx];
    const uf = appendUserIdsFilter(params, userIds);
    const moneyCny = sqlOrderMoneyCny("", "$3");
    const betCny = sqlOrderBetCny("", "$3");
    const pending = sqlAnalyticsPending("");
    const { rows } = await pool.query(
      `SELECT provider,
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE status = 'Win')::int AS wins,
        COUNT(*) FILTER (WHERE status = 'Lose')::int AS losses,
        COUNT(*) FILTER (WHERE status = 'Reject')::int AS rejects,
        COUNT(*) FILTER (WHERE ${pending})::int AS pending,
        COALESCE(SUM(${betCny}), 0)::float AS total_bet,
        COALESCE(SUM(${moneyCny}), 0)::float AS total_profit
       FROM ${financialOrdersRelation()}
       WHERE create_at >= $1 AND create_at < $2 AND provider IS NOT NULL AND provider != ''
         AND NOT ${sqlIsPredictionSell("")}${uf}
       GROUP BY provider
       ORDER BY total_orders DESC`,
      params,
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchPlatformAnalytics:", err.message);
    return [];
  }
}

/**
 * 数据分析：套利配对统计（按 abs(link) 配两馆买单）。
 * - 排除 PM/PF 卖单，避免同一 link 与对馆笛卡尔双计
 * - 每 (user, abs(link), provider) 只取一笔：优先非 Reject，再取最新买单
 * - 分项：对冲方向（A赢B输 / A输B赢）/ 双赢 / 双输 / 拒单组 / 未结算
 */
export async function fetchArbPairAnalytics(startMs, endMs, userIds) {
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const fx = getExchange(Currency.USDT);
    const params = [startMs, endMs, fx];
    const uf = appendUserIdsFilter(params, userIds);
    const userFilterOnO = uf ? uf.replace(/\buser_id\b/g, "o.user_id") : "";
    const moneyA = sqlOrderMoneyCny("a", "$3");
    const moneyB = sqlOrderMoneyCny("b", "$3");
    const betA = sqlOrderBetCny("a", "$3");
    const betB = sqlOrderBetCny("b", "$3");
    const settled = `(status_a IN ('Win','Lose') AND status_b IN ('Win','Lose'))`;
    const aWinBLose = `(status_a = 'Win' AND status_b = 'Lose')`;
    const aLoseBWin = `(status_a = 'Lose' AND status_b = 'Win')`;
    const hedgeOk = `(${aWinBLose} OR ${aLoseBWin})`;
    const hasReject = `(status_a = 'Reject' OR status_b = 'Reject')`;
    const pending = `(NOT ${hasReject} AND (pending_a OR pending_b
      OR status_a = 'Pending' OR status_b = 'Pending'
      OR status_a = 'Return' OR status_b = 'Return'))`;
    const { rows } = await pool.query(
      `WITH ${sqlArbUniqCtes(userFilterOnO)},
      pairs AS (
        SELECT
          a.provider AS provider_a, b.provider AS provider_b,
          a.status AS status_a, b.status AS status_b,
          (${moneyA}) AS money_a, (${moneyB}) AS money_b,
          (${betA}) AS bet_a, (${betB}) AS bet_b,
          (${sqlAnalyticsPending("a")}) AS pending_a,
          (${sqlAnalyticsPending("b")}) AS pending_b
        FROM uniq a
        JOIN uniq b ON ABS(a.link) = ABS(b.link)
          AND a.provider < b.provider
          AND a.user_id = b.user_id
      )
      SELECT
        provider_a, provider_b,
        COUNT(*)::int AS pair_count,
        COUNT(*) FILTER (WHERE ${hedgeOk})::int AS hedge_ok,
        COUNT(*) FILTER (WHERE ${aWinBLose})::int AS a_win_b_lose,
        COUNT(*) FILTER (WHERE ${aLoseBWin})::int AS a_lose_b_win,
        COUNT(*) FILTER (WHERE ${settled})::int AS settled_pairs,
        COUNT(*) FILTER (WHERE status_a = 'Win' AND status_b = 'Win')::int AS both_win,
        COUNT(*) FILTER (WHERE status_a = 'Lose' AND status_b = 'Lose')::int AS both_lose,
        COUNT(*) FILTER (WHERE ${hasReject})::int AS has_reject,
        COUNT(*) FILTER (WHERE status_a = 'Reject')::int AS rejects_a,
        COUNT(*) FILTER (WHERE status_b = 'Reject')::int AS rejects_b,
        COUNT(*) FILTER (WHERE ${pending})::int AS pending_pairs,
        -- 兼容旧字段：非拒单组（含未结算）；UI 改用 hedge_ok/settled_pairs
        COUNT(*) FILTER (WHERE status_a != 'Reject' AND status_b != 'Reject')::int AS both_settled,
        COALESCE(SUM(money_a + money_b), 0)::float AS net_profit,
        COALESCE(SUM(bet_a + bet_b), 0)::float AS total_bet,
        COALESCE(SUM(money_a + money_b) FILTER (WHERE ${hedgeOk}), 0)::float AS profit_hedge,
        COALESCE(SUM(money_a + money_b) FILTER (WHERE ${aWinBLose}), 0)::float AS profit_a_win_b_lose,
        COALESCE(SUM(money_a + money_b) FILTER (WHERE ${aLoseBWin}), 0)::float AS profit_a_lose_b_win,
        COALESCE(SUM(money_a + money_b) FILTER (WHERE ${hasReject}), 0)::float AS profit_reject,
        COALESCE(SUM(money_a + money_b) FILTER (WHERE status_a = 'Lose' AND status_b = 'Lose'), 0)::float AS profit_both_lose,
        COALESCE(SUM(money_a + money_b) FILTER (WHERE status_a = 'Win' AND status_b = 'Win'), 0)::float AS profit_both_win,
        COALESCE(SUM(money_a + money_b) FILTER (WHERE ${pending}), 0)::float AS profit_pending,
        COUNT(*) FILTER (WHERE status_a = 'Win')::int AS wins_a,
        COUNT(*) FILTER (WHERE status_a = 'Lose')::int AS losses_a,
        COALESCE(SUM(money_a), 0)::float AS profit_a,
        COALESCE(SUM(bet_a), 0)::float AS bet_a,
        COUNT(*) FILTER (WHERE status_b = 'Win')::int AS wins_b,
        COUNT(*) FILTER (WHERE status_b = 'Lose')::int AS losses_b,
        COALESCE(SUM(money_b), 0)::float AS profit_b,
        COALESCE(SUM(bet_b), 0)::float AS bet_b
      FROM pairs
      GROUP BY provider_a, provider_b
      ORDER BY pair_count DESC`,
      params,
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchArbPairAnalytics:", err.message);
    return [];
  }
}

/** 数据分析：按游戏维度聚合（通过 match 名关联 client_matches.game） */
export async function fetchGameAnalytics(startMs, endMs, userIds) {
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const fx = getExchange(Currency.USDT);
    const params = [startMs, endMs, fx];
    const uf = appendUserIdsFilter(params, userIds);
    const moneyCny = sqlOrderMoneyCny("o", "$3");
    const betCny = sqlOrderBetCny("o", "$3");
    const { rows } = await pool.query(
      `SELECT
        COALESCE(cm.game, '未知') AS game,
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE o.status = 'Win')::int AS wins,
        COUNT(*) FILTER (WHERE o.status = 'Lose')::int AS losses,
        COUNT(*) FILTER (WHERE o.status = 'Reject')::int AS rejects,
        COALESCE(SUM(${betCny}), 0)::float AS total_bet,
        COALESCE(SUM(${moneyCny}), 0)::float AS total_profit
       FROM ${financialOrdersRelation("o")}
       LEFT JOIN LATERAL (
         SELECT game FROM client_matches
         WHERE title = o.match
         LIMIT 1
       ) cm ON true
       WHERE o.create_at >= $1 AND o.create_at < $2
         AND o.provider IS NOT NULL AND o.provider != ''
         AND NOT ${sqlIsPredictionSell("o")}${uf ? uf.replace("user_id", "o.user_id") : ""}
       GROUP BY COALESCE(cm.game, '未知')
       ORDER BY total_orders DESC`,
      params,
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchGameAnalytics:", err.message);
    return [];
  }
}

/** 数据分析：按小时聚合（时段分布） */
export async function fetchHourlyAnalytics(startMs, endMs, userIds) {
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const fx = getExchange(Currency.USDT);
    const params = [startMs, endMs, fx];
    const uf = appendUserIdsFilter(params, userIds);
    const moneyCny = sqlOrderMoneyCny("", "$3");
    const betCny = sqlOrderBetCny("", "$3");
    const { rows } = await pool.query(
      `SELECT
        EXTRACT(HOUR FROM to_timestamp(create_at / 1000.0))::int AS hour,
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE status = 'Win')::int AS wins,
        COUNT(*) FILTER (WHERE status = 'Lose')::int AS losses,
        COALESCE(SUM(${moneyCny}), 0)::float AS total_profit,
        COALESCE(SUM(${betCny}), 0)::float AS total_bet
       FROM ${financialOrdersRelation()}
       WHERE create_at >= $1 AND create_at < $2
         AND provider IS NOT NULL AND provider != ''
         AND NOT ${sqlIsPredictionSell("")}${uf}
       GROUP BY hour
       ORDER BY hour`,
      params,
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchHourlyAnalytics:", err.message);
    return [];
  }
}

/** 赔率分桶（与套利/正 EV 统计共用） */
function sqlOddsBucketExpr(col = "odds") {
  return `CASE
  WHEN ${col} < 1.5 THEN '1.00-1.49'
  WHEN ${col} < 2.0 THEN '1.50-1.99'
  WHEN ${col} < 2.5 THEN '2.00-2.49'
  WHEN ${col} < 3.0 THEN '2.50-2.99'
  WHEN ${col} < 4.0 THEN '3.00-3.99'
  WHEN ${col} < 6.0 THEN '4.00-5.99'
  ELSE '6.00+'
END`;
}

const ARB_ODDS_BUCKET_SQL = sqlOddsBucketExpr("a.odds");

/**
 * 数据分析：正 EV 单边订单 — 按场馆 / 赔率区间聚合。
 * 识别：ABS(link) >= VALUE_BET_LINK_BASE（与 client-core isValueBetLink 对齐）。
 * 口径：[changmen 扩展]。金额 CNY 与 fetchPlatformAnalytics 一致。
 */
export async function fetchValueBetOrderAnalytics(startMs, endMs, userIds) {
  const pool = getPgPool();
  if (!pool)
    return { byProvider: [], byOddsBucket: [] };
  try {
    const fx = getExchange(Currency.USDT);
    const params = [startMs, endMs, fx, VALUE_BET_LINK_BASE];
    const uf = appendUserIdsFilter(params, userIds);
    const moneyCny = sqlOrderMoneyCny("", "$3");
    const betCny = sqlOrderBetCny("", "$3");
    const oddsBucket = sqlOddsBucketExpr("odds");
    const where = `create_at >= $1 AND create_at < $2
         AND provider IS NOT NULL AND provider != ''
         AND NOT ${sqlIsPredictionSell("")}
         AND ABS(link) >= $4${uf}`;
    const pending = sqlAnalyticsPending("");
    const aggSelect = `
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE status = 'Win')::int AS wins,
        COUNT(*) FILTER (WHERE status = 'Lose')::int AS losses,
        COUNT(*) FILTER (WHERE status = 'Reject')::int AS rejects,
        COUNT(*) FILTER (WHERE ${pending})::int AS pending,
        COALESCE(SUM(${betCny}), 0)::float AS total_bet,
        COALESCE(SUM(${moneyCny}), 0)::float AS total_profit,
        AVG(odds)::float AS avg_odds`;
    const { rows: byProvider } = await pool.query(
      `SELECT provider,${aggSelect}
       FROM ${financialOrdersRelation()}
       WHERE ${where}
       GROUP BY provider
       ORDER BY total_orders DESC`,
      params,
    );
    const { rows: byOddsBucket } = await pool.query(
      `SELECT ${oddsBucket} AS odds_bucket, provider,${aggSelect}
       FROM ${financialOrdersRelation()}
       WHERE ${where}
       GROUP BY odds_bucket, provider
       ORDER BY odds_bucket, provider`,
      params,
    );
    return { byProvider: byProvider || [], byOddsBucket: byOddsBucket || [] };
  }
  catch (err) {
    console.warn("[rds] fetchValueBetOrderAnalytics:", err.message);
    return { byProvider: [], byOddsBucket: [] };
  }
}

/**
 * 数据分析：锚定平台（OB / RAY 等）套利腿 vs 其他平台 — 按赢/输分组的锚定赔率分布。
 * 口径：[changmen 扩展]。与 fetchArbPairAnalytics 共用 legs/uniq（剔卖单 + 去重）；
 * 仅一胜一负对冲（不含双赢/双输）；按锚定侧赔率分桶；盈亏为双腿净利（CNY）。
 */
export async function fetchArbOddsAnalytics(startMs, endMs, userIds, anchorProvider = "OB") {
  const pool = getPgPool();
  if (!pool)
    return { buckets: [], summary: [] };
  try {
    const fx = getExchange(Currency.USDT);
    const params = [startMs, endMs, anchorProvider, fx];
    const uf = appendUserIdsFilter(params, userIds);
    const userFilterOnO = uf ? uf.replace(/\buser_id\b/g, "o.user_id") : "";
    const moneyCnyA = sqlOrderMoneyCny("a", "$4");
    const moneyCnyO = sqlOrderMoneyCny("o", "$4");
    const pairCte = `
      WITH ${sqlArbUniqCtes(userFilterOnO)},
      pair_rows AS (
        SELECT
          a.id AS anchor_id,
          a.status AS anchor_status,
          a.odds AS anchor_odds,
          ${ARB_ODDS_BUCKET_SQL} AS anchor_odds_bucket,
          (${moneyCnyA}) + (${moneyCnyO}) AS pair_money_cny,
          o.provider AS other_provider,
          o.status AS other_status,
          o.odds::float AS other_odds
        FROM uniq a
        JOIN uniq o ON ABS(a.link) = ABS(o.link)
          AND a.user_id = o.user_id
          AND a.provider = $3
          AND o.provider <> $3
        WHERE (
            (a.status = 'Win' AND o.status = 'Lose')
            OR (a.status = 'Lose' AND o.status = 'Win')
          )
      )
    `;
    const otherOutcomeAggs = `
        COUNT(*) FILTER (WHERE other_status = 'Win')::int AS other_wins,
        COUNT(*) FILTER (WHERE other_status = 'Lose')::int AS other_losses,
        COALESCE(SUM(pair_money_cny) FILTER (WHERE other_status = 'Win'), 0)::float AS profit_other_win,
        COALESCE(SUM(pair_money_cny) FILTER (WHERE other_status = 'Lose'), 0)::float AS profit_other_lose`;
    const { rows: buckets } = await pool.query(
      `${pairCte}
      SELECT
        other_provider,
        anchor_status,
        anchor_odds_bucket,
        COUNT(*)::int AS count,
        AVG(anchor_odds)::float AS avg_anchor_odds,
        AVG(other_odds)::float AS avg_other_odds,
        COALESCE(SUM(pair_money_cny), 0)::float AS profit,
        ${otherOutcomeAggs}
      FROM pair_rows
      GROUP BY other_provider, anchor_status, anchor_odds_bucket
      ORDER BY other_provider, anchor_status, anchor_odds_bucket`,
      params,
    );
    const { rows: summary } = await pool.query(
      `${pairCte}
      SELECT
        other_provider,
        anchor_status,
        COUNT(*)::int AS count,
        AVG(anchor_odds)::float AS avg_anchor_odds,
        AVG(other_odds)::float AS avg_other_odds,
        MIN(anchor_odds)::float AS min_anchor_odds,
        MAX(anchor_odds)::float AS max_anchor_odds,
        COALESCE(SUM(pair_money_cny), 0)::float AS profit,
        ${otherOutcomeAggs}
      FROM pair_rows
      GROUP BY other_provider, anchor_status
      ORDER BY other_provider, anchor_status`,
      params,
    );
    return { buckets: buckets || [], summary: summary || [] };
  }
  catch (err) {
    console.warn(`[rds] fetchArbOddsAnalytics(${anchorProvider}):`, err.message);
    return { buckets: [], summary: [] };
  }
}

const PM_PRICE_BAND_SQL = `CASE
  WHEN fill_price IS NULL OR fill_price <= 0 THEN 'unknown'
  WHEN fill_price < 0.30 THEN '0.00-0.30'
  WHEN fill_price < 0.50 THEN '0.30-0.50'
  WHEN fill_price < 0.70 THEN '0.50-0.70'
  ELSE '0.70-1.00'
END`;

/**
 * Polymarket Builder：持有到期 / 赛果视角策略分析（全量）。
 * - 样本：时段内 PM 买单且有赛果（raw.pmMatchResult，兼容旧数据 status Win/Lose）
 * - 含中途卖出单；输赢看赛果，不用实际卖出 Money
 * - 理论盈亏：赢 = bet*(odds-1)，输 = -bet（假使持仓到结算）
 * - 价位带 / 对手场馆按上述口径聚合
 */
export async function fetchPolymarketOrderAnalytics(startMs, endMs, userIds) {
  const pool = getPgPool();
  const empty = {
    summary: {
      groupCount: 0,
      arbGroupCount: 0,
      singleLegCount: 0,
      soldCloseCount: 0,
      winCount: 0,
      loseCount: 0,
      winRate: 0,
      totalPmBet: 0,
      totalHoldProfit: 0,
      roi: 0,
    },
    priceBands: [],
    venues: [],
  };
  if (!pool)
    return empty;
  try {
    const params = [startMs, endMs];
    const uf = appendUserIdsFilter(params, userIds);
    const userFilter = uf ? uf.replace(/\buser_id\b/g, "pm.user_id") : "";

    const groupsCte = `
      WITH pm_buys AS (
        SELECT
          pm.user_id,
          ABS(pm.link) AS link_abs,
          pm.bet_money,
          pm.odds,
          COALESCE(
            NULLIF(pm.raw->>'pmFillPrice', '')::float,
            CASE WHEN pm.odds > 1 THEN 1.0 / pm.odds ELSE NULL END
          ) AS fill_price,
          LOWER(COALESCE(pm.raw->>'pmSellState', '')) AS sell_state,
          CASE
            WHEN LOWER(COALESCE(pm.raw->>'pmMatchResult', '')) IN ('win', 'lose')
              THEN LOWER(pm.raw->>'pmMatchResult')
            WHEN LOWER(pm.status) IN ('win', 'lose')
              THEN LOWER(pm.status)
            ELSE NULL
          END AS match_result
        FROM ${financialOrdersRelation("pm")}
        WHERE pm.provider = 'Polymarket'
          AND LOWER(COALESCE(pm.raw->>'pmSide', '')) IS DISTINCT FROM 'sell'
          AND pm.create_at >= $1 AND pm.create_at < $2
          AND pm.link IS NOT NULL
          AND ABS(pm.link) <> 0
          ${userFilter}
      ),
      settled_buys AS (
        SELECT
          *,
          CASE
            WHEN match_result = 'win' AND odds > 1 THEN bet_money * (odds - 1)
            WHEN match_result = 'lose' THEN -bet_money
            ELSE 0
          END AS hold_profit
        FROM pm_buys
        WHERE match_result IN ('win', 'lose')
      ),
      anchors AS (
        SELECT
          user_id,
          link_abs,
          SUM(bet_money)::float AS pm_bet,
          SUM(hold_profit)::float AS hold_profit,
          AVG(fill_price) FILTER (WHERE fill_price IS NOT NULL AND fill_price > 0)::float AS fill_price,
          BOOL_OR(sell_state = 'closed') AS sold_closed,
          -- 同组多条 PM 买单时：全赢才算赢，否则有输算输
          CASE
            WHEN BOOL_AND(match_result = 'win') THEN 'win'
            ELSE 'lose'
          END AS match_result,
          COUNT(*) FILTER (WHERE match_result = 'win')::int AS win_legs,
          COUNT(*) FILTER (WHERE match_result = 'lose')::int AS lose_legs
        FROM settled_buys
        GROUP BY user_id, link_abs
      ),
      groups AS (
        SELECT
          a.user_id,
          a.link_abs,
          a.pm_bet,
          a.hold_profit,
          a.fill_price,
          a.sold_closed,
          a.match_result,
          (a.link_abs >= 1000000000000) AS is_arb_link,
          COUNT(DISTINCT o.provider) FILTER (
            WHERE o.provider IS DISTINCT FROM 'Polymarket'
              AND o.provider IS NOT NULL
              AND o.provider <> ''
          )::int AS other_venue_count
        FROM anchors a
        LEFT JOIN ${financialOrdersRelation("o")}
          ON o.user_id = a.user_id
          AND ABS(o.link) = a.link_abs
        GROUP BY a.user_id, a.link_abs, a.pm_bet, a.hold_profit, a.fill_price,
          a.sold_closed, a.match_result
      )`;

    const { rows: summaryRows } = await pool.query(
      `${groupsCte}
      SELECT
        COUNT(*)::int AS group_count,
        COUNT(*) FILTER (WHERE is_arb_link AND other_venue_count > 0)::int AS arb_group_count,
        COUNT(*) FILTER (WHERE other_venue_count = 0 OR NOT is_arb_link)::int AS single_leg_count,
        COUNT(*) FILTER (WHERE sold_closed)::int AS sold_close_count,
        COUNT(*) FILTER (WHERE match_result = 'win')::int AS win_count,
        COUNT(*) FILTER (WHERE match_result = 'lose')::int AS lose_count,
        COALESCE(SUM(pm_bet), 0)::float AS total_pm_bet,
        COALESCE(SUM(hold_profit), 0)::float AS total_hold_profit
      FROM groups`,
      params,
    );

    const { rows: priceBands } = await pool.query(
      `${groupsCte}
      SELECT
        ${PM_PRICE_BAND_SQL} AS price_band,
        COUNT(*)::int AS group_count,
        COUNT(*) FILTER (WHERE match_result = 'win')::int AS win_count,
        COUNT(*) FILTER (WHERE match_result = 'lose')::int AS lose_count,
        COALESCE(SUM(pm_bet), 0)::float AS pm_bet,
        COALESCE(SUM(hold_profit), 0)::float AS hold_profit,
        AVG(fill_price) FILTER (WHERE fill_price IS NOT NULL AND fill_price > 0)::float AS avg_fill_price
      FROM groups
      GROUP BY price_band
      ORDER BY price_band`,
      params,
    );

    const { rows: venues } = await pool.query(
      `${groupsCte},
      venue_groups AS (
        SELECT
          g.user_id,
          g.link_abs,
          g.pm_bet,
          g.hold_profit,
          g.fill_price,
          g.match_result,
          other.provider AS other_provider
        FROM groups g
        JOIN ${financialOrdersRelation("other")}
          ON other.user_id = g.user_id
          AND ABS(other.link) = g.link_abs
          AND other.provider IS DISTINCT FROM 'Polymarket'
          AND other.provider IS NOT NULL
          AND other.provider <> ''
        WHERE g.is_arb_link
        GROUP BY g.user_id, g.link_abs, g.pm_bet, g.hold_profit, g.fill_price,
          g.match_result, other.provider
      )
      SELECT
        other_provider,
        COUNT(*)::int AS group_count,
        COUNT(*) FILTER (WHERE match_result = 'win')::int AS win_count,
        COUNT(*) FILTER (WHERE match_result = 'lose')::int AS lose_count,
        COALESCE(SUM(pm_bet), 0)::float AS pm_bet,
        COALESCE(SUM(hold_profit), 0)::float AS hold_profit,
        AVG(fill_price) FILTER (WHERE fill_price IS NOT NULL AND fill_price > 0)::float AS avg_fill_price
      FROM venue_groups
      GROUP BY other_provider
      ORDER BY group_count DESC, other_provider`,
      params,
    );

    const mapBandOrVenue = (r) => {
      const pmBet = Number(r.pm_bet) || 0;
      const holdProfit = Number(r.hold_profit) || 0;
      const winCount = Number(r.win_count) || 0;
      const loseCount = Number(r.lose_count) || 0;
      const decided = winCount + loseCount;
      return {
        group_count: Number(r.group_count) || 0,
        win_count: winCount,
        lose_count: loseCount,
        win_rate: decided > 0 ? winCount / decided : 0,
        pm_bet: pmBet,
        hold_profit: holdProfit,
        avg_fill_price: Number(r.avg_fill_price) || 0,
        roi: pmBet > 0 ? holdProfit / pmBet : 0,
      };
    };

    const s = summaryRows?.[0] || {};
    const totalPmBet = Number(s.total_pm_bet) || 0;
    const totalHoldProfit = Number(s.total_hold_profit) || 0;
    const winCount = Number(s.win_count) || 0;
    const loseCount = Number(s.lose_count) || 0;
    const decided = winCount + loseCount;
    return {
      summary: {
        groupCount: Number(s.group_count) || 0,
        arbGroupCount: Number(s.arb_group_count) || 0,
        singleLegCount: Number(s.single_leg_count) || 0,
        soldCloseCount: Number(s.sold_close_count) || 0,
        winCount,
        loseCount,
        winRate: decided > 0 ? winCount / decided : 0,
        totalPmBet,
        totalHoldProfit,
        roi: totalPmBet > 0 ? totalHoldProfit / totalPmBet : 0,
      },
      priceBands: (priceBands || []).map(r => ({
        price_band: r.price_band,
        ...mapBandOrVenue(r),
      })),
      venues: (venues || []).map(r => ({
        other_provider: r.other_provider,
        ...mapBandOrVenue(r),
      })),
    };
  }
  catch (err) {
    console.warn("[rds] fetchPolymarketOrderAnalytics:", err.message);
    return empty;
  }
}

function polymarketOrdersRangeWhere(startMs, endMs, userIds) {
  const params = [startMs, endMs];
  let where = `o.create_at >= $1 AND o.create_at < $2 AND o.provider = 'Polymarket'`;
  if (Array.isArray(userIds) && userIds.length) {
    params.push(userIds);
    where += ` AND o.user_id = ANY($${params.length}::uuid[])`;
  }
  return { params, where };
}

/** Polymarket Builder 看板：时间范围内 changmen Polymarket 订单汇总（不受列表 LIMIT 影响） */
export async function fetchPolymarketOrderStatsInRange(startMs, endMs, userIds) {
  const pool = getPgPool();
  const empty = {
    orderCount: 0,
    totalBet: 0,
    totalProfit: 0,
    wins: 0,
    losses: 0,
    rejects: 0,
    pending: 0,
  };
  if (!pool)
    return empty;
  try {
    const { params, where } = polymarketOrdersRangeWhere(startMs, endMs, userIds);
    // 卖单非下注：totalBet / totalProfit 只计买单（盈亏已累加在买单 money）
    const { rows } = await pool.query(
      `SELECT
        COUNT(*)::int AS order_count,
        COALESCE(SUM(o.bet_money) FILTER (
          WHERE LOWER(COALESCE(o.raw->>'pmSide', '')) IS DISTINCT FROM 'sell'
        ), 0)::float AS total_bet,
        COALESCE(SUM(o.money) FILTER (
          WHERE LOWER(COALESCE(o.raw->>'pmSide', '')) IS DISTINCT FROM 'sell'
        ), 0)::float AS total_profit,
        COUNT(*) FILTER (WHERE o.status = 'Win')::int AS wins,
        COUNT(*) FILTER (WHERE o.status = 'Lose')::int AS losses,
        COUNT(*) FILTER (WHERE o.status = 'Reject')::int AS rejects,
        COUNT(*) FILTER (WHERE o.status IS DISTINCT FROM 'Win'
          AND o.status IS DISTINCT FROM 'Lose'
          AND o.status IS DISTINCT FROM 'Reject')::int AS pending
       FROM ${financialOrdersRelation("o")}
       WHERE ${where}`,
      params,
    );
    const row = rows?.[0];
    if (!row)
      return empty;
    return {
      orderCount: Number(row.order_count) || 0,
      totalBet: Number(row.total_bet) || 0,
      totalProfit: Number(row.total_profit) || 0,
      wins: Number(row.wins) || 0,
      losses: Number(row.losses) || 0,
      rejects: Number(row.rejects) || 0,
      pending: Number(row.pending) || 0,
    };
  }
  catch (err) {
    console.warn("[rds] fetchPolymarketOrderStatsInRange:", err.message);
    return empty;
  }
}

/** Polymarket Builder 看板：时间范围内 changmen Polymarket 订单列表 */
export async function fetchPolymarketOrdersInRange(startMs, endMs, userIds, limit = 500) {
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const { params, where } = polymarketOrdersRangeWhere(startMs, endMs, userIds);
    params.push(Math.min(Math.max(Number(limit) || 500, 1), 500));
    const { rows } = await pool.query(
      `SELECT o.order_id, o.user_id, o.player_id, o.provider, o.match, o.bet, o.item,
              o.status, o.bet_money, o.money, o.odds, o.create_at, o.raw,
              COALESCE(o.raw->>'game', '') AS game,
              COALESCE(o.raw->>'pmSide', '') AS pm_side,
              NULLIF(o.raw->>'pmFillPrice', '')::float AS fill_price,
              p.user_name
       FROM ${financialOrdersRelation("o")}
       LEFT JOIN profiles p ON p.id = o.user_id
       WHERE ${where}
       ORDER BY o.create_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchPolymarketOrdersInRange:", err.message);
    return [];
  }
}

/** 数据分析：按账号（player_id）聚合 */
export async function fetchAccountAnalytics(startMs, endMs, userIds) {
  const pool = getPgPool();
  if (!pool)
    return [];
  try {
    const fx = getExchange(Currency.USDT);
    const params = [startMs, endMs, fx];
    const uf = appendUserIdsFilter(params, userIds);
    const moneyCny = sqlOrderMoneyCny("o", "$3");
    const betCny = sqlOrderBetCny("o", "$3");
    const { rows } = await pool.query(
      `SELECT
        o.player_id,
        o.provider,
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE o.status = 'Win')::int AS wins,
        COUNT(*) FILTER (WHERE o.status = 'Lose')::int AS losses,
        COUNT(*) FILTER (WHERE o.status = 'Reject')::int AS rejects,
        COALESCE(SUM(${betCny}), 0)::float AS total_bet,
        COALESCE(SUM(${moneyCny}), 0)::float AS total_profit
       FROM ${financialOrdersRelation("o")}
       WHERE o.create_at >= $1 AND o.create_at < $2
         AND o.provider IS NOT NULL AND o.provider != ''
         AND NOT ${sqlIsPredictionSell("o")}${uf ? uf.replace("user_id", "o.user_id") : ""}
       GROUP BY o.player_id, o.provider
       ORDER BY total_profit DESC`,
      params,
    );
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchAccountAnalytics:", err.message);
    return [];
  }
}

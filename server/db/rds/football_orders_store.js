/**
 * football_orders — 足球跟单订单。禁止读写电竞 orders。
 */
import { getPgPool } from "./common.js";
import { localDayBounds, localMonthBounds } from "./time_bounds.js";

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS football_orders (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  player_id       bigint,
  venue           text NOT NULL DEFAULT 'OB',
  venue_order_id  text NOT NULL DEFAULT '',
  client_id       text NOT NULL,
  home            text NOT NULL DEFAULT '',
  away            text NOT NULL DEFAULT '',
  side_label      text NOT NULL DEFAULT '',
  market_label    text NOT NULL DEFAULT '',
  odds            double precision NOT NULL DEFAULT 0,
  stake           double precision NOT NULL DEFAULT 0,
  oid             text NOT NULL DEFAULT '',
  ob_mid          text NOT NULL DEFAULT '',
  auto            boolean NOT NULL DEFAULT false,
  account_name    text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'None',
  profit          double precision NOT NULL DEFAULT 0,
  placed_at       bigint NOT NULL,
  created_at      bigint NOT NULL
)`;

const INDEX_DDL = [
  `CREATE UNIQUE INDEX IF NOT EXISTS football_orders_user_client_uidx
     ON football_orders (user_id, client_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS football_orders_user_venue_oid_uidx
     ON football_orders (user_id, venue, venue_order_id)
     WHERE venue_order_id <> ''`,
  `CREATE INDEX IF NOT EXISTS football_orders_placed_at_desc
     ON football_orders (placed_at DESC)`,
  `CREATE INDEX IF NOT EXISTS football_orders_user_placed
     ON football_orders (user_id, placed_at DESC)`,
];

const COLUMN_DDL = [
  `ALTER TABLE football_orders ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'None'`,
  `ALTER TABLE football_orders ADD COLUMN IF NOT EXISTS profit double precision NOT NULL DEFAULT 0`,
];

let ensured = false;

async function ensureTable(pool) {
  if (ensured)
    return;
  await pool.query(TABLE_DDL);
  for (const sql of COLUMN_DDL)
    await pool.query(sql);
  for (const sql of INDEX_DDL)
    await pool.query(sql);
  ensured = true;
}

const SELECT_COLS = `
  o.id, o.user_id, o.player_id, o.venue, o.venue_order_id, o.client_id,
  o.home, o.away, o.side_label, o.market_label, o.odds, o.stake,
  o.oid, o.ob_mid, o.auto, o.account_name, o.status, o.profit,
  o.placed_at, o.created_at,
  p.user_name
`;

const RETURNING_COLS = `
  id, user_id, player_id, venue, venue_order_id, client_id,
  home, away, side_label, market_label, odds, stake,
  oid, ob_mid, auto, account_name, status, profit, placed_at, created_at
`;

const TERMINAL = "('Win','Lose','Reject','Return')";

/**
 * @param {object} row
 * @returns {Promise<object|null>}
 */
export async function upsertFootballOrder(row) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  await ensureTable(pool);
  const sql = `
    INSERT INTO football_orders (
      user_id, player_id, venue, venue_order_id, client_id,
      home, away, side_label, market_label, odds, stake,
      oid, ob_mid, auto, account_name, status, profit, placed_at, created_at
    )
    VALUES (
      $1::uuid, $2, $3, $4, $5,
      $6, $7, $8, $9, $10, $11,
      $12, $13, $14, $15, $16, $17, $18, $19
    )
    ON CONFLICT (user_id, client_id) DO UPDATE SET
      venue_order_id = CASE
        WHEN EXCLUDED.venue_order_id <> '' THEN EXCLUDED.venue_order_id
        ELSE football_orders.venue_order_id
      END,
      player_id = COALESCE(EXCLUDED.player_id, football_orders.player_id),
      home = CASE WHEN EXCLUDED.home <> '' THEN EXCLUDED.home ELSE football_orders.home END,
      away = CASE WHEN EXCLUDED.away <> '' THEN EXCLUDED.away ELSE football_orders.away END,
      side_label = CASE WHEN EXCLUDED.side_label <> '' THEN EXCLUDED.side_label ELSE football_orders.side_label END,
      market_label = CASE WHEN EXCLUDED.market_label <> '' THEN EXCLUDED.market_label ELSE football_orders.market_label END,
      odds = CASE WHEN EXCLUDED.odds > 0 THEN EXCLUDED.odds ELSE football_orders.odds END,
      stake = CASE WHEN EXCLUDED.stake > 0 THEN EXCLUDED.stake ELSE football_orders.stake END,
      oid = CASE WHEN EXCLUDED.oid <> '' THEN EXCLUDED.oid ELSE football_orders.oid END,
      ob_mid = CASE WHEN EXCLUDED.ob_mid <> '' THEN EXCLUDED.ob_mid ELSE football_orders.ob_mid END,
      auto = football_orders.auto OR EXCLUDED.auto,
      account_name = CASE WHEN EXCLUDED.account_name <> '' THEN EXCLUDED.account_name ELSE football_orders.account_name END,
      status = CASE
        WHEN EXCLUDED.status IN ${TERMINAL} THEN EXCLUDED.status
        ELSE football_orders.status
      END,
      profit = CASE
        WHEN EXCLUDED.status IN ${TERMINAL} THEN EXCLUDED.profit
        ELSE football_orders.profit
      END
    RETURNING ${RETURNING_COLS}
  `;
  try {
    const { rows } = await pool.query(sql, [
      row.userId,
      row.playerId,
      row.venue,
      row.venueOrderId,
      row.clientId,
      row.home,
      row.away,
      row.sideLabel,
      row.marketLabel,
      row.odds,
      row.stake,
      row.oid,
      row.obMid,
      row.auto === true,
      row.accountName,
      row.status || "None",
      Number(row.profit) || 0,
      row.placedAt,
      row.createdAt,
    ]);
    return rows[0] || null;
  }
  catch (err) {
    if (String(err?.code) === "23505" && row.venueOrderId) {
      const { rows } = await pool.query(
        `SELECT ${RETURNING_COLS}
         FROM football_orders
         WHERE user_id = $1::uuid AND venue = $2 AND venue_order_id = $3
         LIMIT 1`,
        [row.userId, row.venue, row.venueOrderId],
      );
      return rows[0] || null;
    }
    throw err;
  }
}

/**
 * 场馆单号回写结算。禁止覆盖已终结态为 None。
 * @param {{ userId: string, venue?: string, venueOrderId: string, status: string, profit?: number }} row
 */
export async function patchFootballOrderStatus(row) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  await ensureTable(pool);
  const venueOrderId = String(row.venueOrderId || "").trim();
  if (!venueOrderId)
    return null;
  const { rows } = await pool.query(
    `UPDATE football_orders SET
       status = CASE
         WHEN $4 IN ${TERMINAL} THEN $4
         ELSE football_orders.status
       END,
       profit = CASE
         WHEN $4 IN ${TERMINAL} THEN $5
         ELSE football_orders.profit
       END
     WHERE user_id = $1::uuid
       AND venue = $2
       AND venue_order_id = $3
     RETURNING ${RETURNING_COLS}`,
    [
      row.userId,
      String(row.venue || "OB").trim() || "OB",
      venueOrderId,
      row.status || "None",
      Number(row.profit) || 0,
    ],
  );
  return rows[0] || null;
}

/**
 * @param {string} userId
 * @param {{ limit?: number, date?: string }} [opts]
 */
export async function fetchFootballOrdersByUser(userId, opts = {}) {
  const pool = getPgPool();
  if (!pool)
    return [];
  await ensureTable(pool);
  // 与电竞按日订单列表上限一致；只控制单日返回量，不扩展日期范围。
  const limit = Math.min(Math.max(Number(opts.limit) || 1024, 1), 1024);
  const clauses = ["o.user_id = $1::uuid"];
  const params = [userId];
  const dateKey = String(opts.date || "").trim();
  if (dateKey) {
    const { dayStart, dayEnd } = localDayBounds(dateKey);
    params.push(dayStart, dayEnd);
    clauses.push(`o.placed_at >= $${params.length - 1} AND o.placed_at < $${params.length}`);
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS}
     FROM football_orders o
     LEFT JOIN profiles p ON p.id = o.user_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY o.placed_at DESC, o.id DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/**
 * @param {string} userId
 * @param {{ limit?: number, sinceMs?: number }} [opts]
 */
export async function fetchOpenFootballOrdersByUser(userId, opts = {}) {
  const pool = getPgPool();
  if (!pool)
    return [];
  await ensureTable(pool);
  const limit = Math.min(Math.max(Number(opts.limit) || 500, 1), 1000);
  const sinceMs = Math.max(0, Number(opts.sinceMs) || 0);
  const params = [userId];
  const clauses = [
    "o.user_id = $1::uuid",
    "o.status IN ('None','Pending')",
  ];
  if (sinceMs > 0) {
    params.push(sinceMs);
    clauses.push(`o.placed_at >= $${params.length}`);
  }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS}
     FROM football_orders o
     LEFT JOIN profiles p ON p.id = o.user_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY o.placed_at DESC, o.id DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function fetchFootballOrderByVenueOrderId(userId, venueOrderId, venue = "OB") {
  const pool = getPgPool();
  if (!pool)
    return null;
  await ensureTable(pool);
  const oid = String(venueOrderId || "").trim();
  if (!oid)
    return null;
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS}
     FROM football_orders o
     LEFT JOIN profiles p ON p.id = o.user_id
     WHERE o.user_id = $1::uuid
       AND o.venue = $2
       AND o.venue_order_id = $3
     LIMIT 1`,
    [userId, String(venue || "OB").trim() || "OB", oid],
  );
  return rows[0] || null;
}

/**
 * @param {{ date?: string, userId?: string, limit?: number }} opts
 */
export async function fetchFootballOrdersAdmin(opts = {}) {
  const pool = getPgPool();
  if (!pool)
    throw new Error("DATABASE_URL 未配置");
  await ensureTable(pool);
  const limit = Math.min(Math.max(Number(opts.limit) || 2000, 1), 5000);
  const clauses = ["UPPER(TRIM(o.venue)) = 'OB'"];
  const params = [];
  const dateKey = String(opts.date || "").trim();
  if (dateKey) {
    const { dayStart, dayEnd } = localDayBounds(dateKey);
    params.push(dayStart, dayEnd);
    clauses.push(`o.placed_at >= $${params.length - 1} AND o.placed_at < $${params.length}`);
  }
  const userId = String(opts.userId || "").trim();
  if (userId) {
    params.push(userId);
    clauses.push(`o.user_id = $${params.length}::uuid`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLS}
     FROM football_orders o
     LEFT JOIN profiles p ON p.id = o.user_id
     ${where}
     ORDER BY o.placed_at DESC, o.id DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export async function deleteFootballOrdersByIds(ids) {
  const pool = getPgPool();
  if (!pool)
    return 0;
  await ensureTable(pool);
  const clean = (Array.isArray(ids) ? ids : [ids])
    .map(id => Number(id))
    .filter(n => Number.isFinite(n) && n > 0);
  if (!clean.length)
    return 0;
  const res = await pool.query(
    "DELETE FROM football_orders WHERE id = ANY($1::bigint[])",
    [clean],
  );
  return res.rowCount ?? 0;
}

/**
 * 足球月报：只读 football_orders。禁止查电竞 orders / money_logs。
 * @param {string} monthKey YYYY-MM
 * @param {string} [userId]
 * @param {string[]} [userIds]
 */
export async function fetchFootballOrdersForMonthAggregate(monthKey, userId, userIds) {
  const { monthStart, monthEnd } = localMonthBounds(monthKey);
  const pool = getPgPool();
  if (!pool)
    return [];
  await ensureTable(pool);
  try {
    const params = [monthStart, monthEnd];
    let sql = `SELECT user_id, venue, stake, profit, status, placed_at
               FROM football_orders
               WHERE placed_at >= $1 AND placed_at < $2
                 AND UPPER(TRIM(venue)) = 'OB'`;
    if (userId) {
      params.push(String(userId));
      sql += ` AND user_id = $${params.length}::uuid`;
    }
    else if (Array.isArray(userIds) && userIds.length) {
      params.push(userIds);
      sql += ` AND user_id = ANY($${params.length}::uuid[])`;
    }
    const { rows } = await pool.query(sql, params);
    return rows || [];
  }
  catch (err) {
    console.warn("[rds] fetchFootballOrdersForMonthAggregate:", err.message);
    return [];
  }
}

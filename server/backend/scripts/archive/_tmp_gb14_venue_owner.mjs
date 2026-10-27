#!/usr/bin/env node
/** 在 GB14 四个 OB 账号上查重复 order_id 是否存在于场馆 */
import { loadChangmenEnv } from "@changmen/storage/load_env";
import { playerRowToAccountRecord } from "../../db/player_account_record.js";
import { parseVenueCreateAt } from "@changmen/shared/time/match_time";

loadChangmenEnv();
const { ensurePgPoolReady } = await import("@changmen/db");
const pool = await ensurePgPoolReady();
const uid = (await pool.query(`SELECT id FROM profiles WHERE user_name ILIKE 'GB14'`)).rows[0].id;

const SAMPLE = process.argv.slice(2);
const ORDER_IDS = SAMPLE.length
  ? SAMPLE
  : ["1728733902429161529", "1732774685798387545", "1780668329619188740"];

const PLAYER_IDS = [92, 93, 94, 95];

function obHeaders(token) {
  return {
    device: "1",
    lang: "cn",
    token: token || "",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  };
}

async function fetchObRange(account, begin, end) {
  const byId = new Map();
  for (const status of [1, 2]) {
    let page = 1;
    for (;;) {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: "100",
        begin_time: begin,
        end_time: end,
        status: String(status),
      });
      const url = `${account.gateway.replace(/\/$/, "")}/game/orderList?${qs}`;
      const res = await fetch(url, { headers: obHeaders(account.token) });
      const text = await res.text();
      if (res.status >= 400)
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 80)}`);
      const data = JSON.parse(text);
      if (!data || data.status !== "true")
        break;
      const bets = data.data?.bet ?? [];
      for (const row of bets) {
        const id = String(row.id ?? "");
        if (id)
          byId.set(id, row);
      }
      if (bets.length < 100)
        break;
      page += 1;
    }
  }
  return byId;
}

const { rows: plRows } = await pool.query(
  `SELECT * FROM players WHERE id = ANY($1::bigint[]) AND owner_user_id = $2::uuid ORDER BY id`,
  [PLAYER_IDS, uid],
);

const accounts = plRows.map(row => ({
  playerId: Number(row.id),
  label: `${row.id} ${row.platform_name}/${row.player_name}`,
  account: playerRowToAccountRecord({
    id: row.id,
    platformName: row.platform_name,
    playerName: row.player_name,
    provider: row.provider,
    accountData: row.account_data,
  }),
}));

// 2026-07 全月
const begin = "2026-07-01 00:00:00";
const end = "2026-07-31 23:59:59";

console.log("拉取 2026-07 OB orderList …");
const venueByPlayer = new Map();
for (const { playerId, label, account } of accounts) {
  if (!account.gateway || !account.token) {
    console.log(`${label}: 无凭证 SKIP`);
    continue;
  }
  try {
    const orders = await fetchObRange(account, begin, end);
    venueByPlayer.set(playerId, orders);
    console.log(`${label}: 场馆 ${orders.size} 条`);
  }
  catch (err) {
    console.log(`${label}: ERR ${err.message}`);
    venueByPlayer.set(playerId, null);
  }
}

console.log("\n=== 场馆 order_id 归属 ===");
for (const orderId of ORDER_IDS) {
  const hits = [];
  for (const [pid, map] of venueByPlayer) {
    if (map?.has(orderId))
      hits.push(pid);
  }
  const label = hits.length === 1
    ? `→ player ${hits[0]}`
    : hits.length === 0
      ? "→ 四账号均未拉到(过期/506?)"
      : `→ 多账号都有: ${hits.join(",")} (异常)`;
  console.log(`${orderId}\t${label}`);
}

await pool.end();

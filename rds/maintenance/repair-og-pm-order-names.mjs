/** [changmen 扩展] 修复 PM 场次 1285216 的旧订单队名；默认只读，不进入启动或部署。 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EVENT = "1285216", TITLE = "OG vs BC.Game Esports", OLD_TITLE = "Team Spirit vs BC.Game Esports";

export function ogOrderTokenNames(match) {
  assert.equal(String(match?.id), "9189");
  assert.equal(match.title, TITLE);
  assert.equal(String(match.matchs?.Polymarket), EVENT);
  assert.equal(String(match.home_gb_team_id), "100931");
  assert.equal(String(match.away_gb_team_id), "101039");
  const names = new Map();
  for (const bet of match.bets || []) {
    for (const [side, name] of [["Home", "OG"], ["Away", "BC.Game Esports"]]) {
      const token = String(bet.Sources?.Polymarket?.[`${side}ID`] || "");
      if (!token) continue;
      assert.equal(bet[`${side}Name`], name);
      assert(!names.has(token) || names.get(token) === name, "Ambiguous token side");
      names.set(token, name);
    }
  }
  assert(names.size > 0, "Missing PM token evidence");
  return names;
}

export function planOgOrderName(row, tokenNames) {
  assert.equal(row.provider, "Polymarket");
  assert.equal(String(row.raw?.venueMatchId), EVENT);
  const name = tokenNames.get(String(row.raw?.pmTokenId || ""));
  assert(name, `Unknown PM token: order ${row.id}`);
  const title = value => {
    assert([OLD_TITLE, TITLE].includes(value), `Unexpected match title: order ${row.id}`);
    return TITLE;
  };
  const item = value => {
    assert(value === name || (value === "Team Spirit" && name === "OG"), `Token/item mismatch: order ${row.id}`);
    return name;
  };
  const raw = { ...row.raw };
  for (const key of ["match", "Match"]) if (Object.hasOwn(raw, key)) raw[key] = title(raw[key]);
  for (const key of ["item", "Item"]) if (Object.hasOwn(raw, key)) raw[key] = item(raw[key]);
  const patch = { id: row.id, match: title(row.match), item: item(row.item), raw };
  return row.match === patch.match && row.item === patch.item
    && JSON.stringify(row.raw) === JSON.stringify(raw) ? null : patch;
}

export async function repairOgPmOrderNames(client, { apply = false, saveBackup } = {}) {
  await client.query(apply ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const { rows: matches } = await client.query(`SELECT id,title,matchs,bets,home_gb_team_id,away_gb_team_id
      FROM client_matches WHERE id=9189${apply ? " FOR SHARE" : ""}`);
    const names = ogOrderTokenNames(matches[0]);
    const { rows } = await client.query(`SELECT * FROM orders WHERE provider='Polymarket'
      AND raw->>'venueMatchId'=$1 ORDER BY id${apply ? " FOR UPDATE" : ""}`, [EVENT]);
    assert(rows.length > 0, "No matching orders");
    const patches = rows.map(row => planOgOrderName(row, names)).filter(Boolean);
    let backup = null;
    if (apply && patches.length) {
      assert.equal(typeof saveBackup, "function", "Backup writer required");
      backup = await saveBackup({ createdAt: new Date().toISOString(), match: matches[0],
        orders: rows.filter(row => patches.some(p => p.id === row.id)), patches });
      for (const patch of patches) {
        const result = await client.query("UPDATE orders SET match=$2,item=$3,raw=$4::jsonb WHERE id=$1",
          [patch.id, patch.match, patch.item, JSON.stringify(patch.raw)]);
        assert.equal(result.rowCount, 1);
      }
      const { rows: after } = await client.query("SELECT * FROM orders WHERE id=ANY($1::bigint[]) ORDER BY id", [patches.map(p => p.id)]);
      assert.deepEqual(after, rows.filter(row => patches.some(p => p.id === row.id))
        .map(row => ({ ...row, ...patches.find(p => p.id === row.id) })), "Non-name order fields changed");
    }
    await client.query("COMMIT");
    return { readOnly: !apply, inspected: rows.length, changed: patches.length,
      orders: patches.map(p => ({ id: p.id, match: p.match, item: p.item })), backup };
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.every(arg => arg === "--apply"), "Only --apply is supported; default is read only");
  const { ensurePgPoolReady } = await import("@changmen/db");
  const pool = await ensurePgPoolReady(), client = await pool.connect();
  try {
    console.log(JSON.stringify(await repairOgPmOrderNames(client, { apply: args.includes("--apply"), saveBackup: async data => {
      const directory = fileURLToPath(new URL("../../output/og-spirit-repair/", import.meta.url));
      await mkdir(directory, { recursive: true });
      const file = path.join(directory, `orders-backup-${Date.now()}.json`);
      await writeFile(file, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
      return file;
    } }), null, 2));
  } finally { client.release(); await pool.end(); }
}

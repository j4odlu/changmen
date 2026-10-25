/** 仅清理 2026-10-25 单馆测试生成的七条合场记录；默认只读，不接入启动或部署。 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const targets = new Map([
  [8746, "1210293"], [8747, "1234010"], [8748, "1234011"],
  [8749, "1210294"], [8750, "1210310"], [8751, "1234012"], [8752, "1216486"],
]);

export async function removeSingleVenueBasketball(client, { apply = false, saveBackup } = {}) {
  const ids = [...targets.keys()], sourceIds = [...targets.values()];
  await client.query(apply ? "BEGIN" : "BEGIN READ ONLY");
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const { rows } = await client.query(
      `SELECT * FROM client_matches WHERE id=ANY($1::bigint[]) ORDER BY id${apply ? " FOR UPDATE" : ""}`, [ids],
    );
    for (const row of rows) {
      assert.equal(Number(row.game_id), 10001, `Wrong game: ${row.id}`);
      assert.equal(row.ended_at, null, `Already ended: ${row.id}`);
      assert.deepEqual(row.matchs, { Polymarket: targets.get(Number(row.id)) }, `Mapping changed: ${row.id}`);
    }
    const { rows: platforms } = await client.query(
      `SELECT * FROM platform_matches WHERE match_id=ANY($1::bigint[])
        OR (platform='Polymarket' AND source_match_id=ANY($2::text[]))
        ORDER BY platform,source_match_id${apply ? " FOR UPDATE" : ""}`, [ids, sourceIds],
    );
    for (const row of platforms) {
      assert.equal(row.platform, "Polymarket", "Unexpected venue binding");
      assert(sourceIds.includes(row.source_match_id), "Unexpected source binding");
      if (row.match_id != null)
        assert.equal(targets.get(Number(row.match_id)), row.source_match_id, "Source reassigned");
    }
    const { rows: fks } = await client.query(`SELECT conrelid::regclass::text AS relation,
      pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE contype='f' AND confrelid='client_matches'::regclass`);
    assert.deepEqual(fks.map(r => r.relation).sort(), ["client_match_platform_overrides", "platform_matches"]);
    assert(fks.find(r => r.relation === "platform_matches").definition.includes("ON DELETE SET NULL"));
    const count = async (sql, params) => Number((await client.query(sql, params)).rows[0].count);
    assert.equal(await count("SELECT COUNT(*) AS count FROM client_match_platform_overrides WHERE client_match_id=ANY($1::bigint[])", [ids]), 0, "Side overrides exist");
    assert.equal(await count(`SELECT COUNT(*) AS count FROM orders WHERE match=ANY($1::text[])
      OR raw->>'matchId'=ANY($2::text[]) OR raw->>'MatchID'=ANY($2::text[])
      OR (provider='Polymarket' AND raw->>'venueMatchId'=ANY($3::text[]))`,
    [rows.map(r => r.title), ids.map(String), sourceIds]), 0, "Orders reference these matches");
    assert.equal(await count("SELECT COUNT(*) AS count FROM order_observations WHERE event->>'matchId'=ANY($1::text[])", [ids.map(String)]), 0, "Order observations exist");
    assert.equal(await count("SELECT COUNT(*) AS count FROM value_signals WHERE match_id=ANY($1::bigint[])", [ids]), 0, "Value signals exist");
    let backup = null;
    if (apply && rows.length) {
      assert.equal(typeof saveBackup, "function", "Backup is required before deletion");
      backup = await saveBackup({ createdAt: new Date().toISOString(), clientMatches: rows, platformMatches: platforms });
      const removed = await client.query("DELETE FROM client_matches WHERE id=ANY($1::bigint[]) RETURNING id", [rows.map(r => r.id)]);
      assert.equal(removed.rowCount, rows.length);
      const { rows: after } = await client.query(`SELECT * FROM platform_matches WHERE platform='Polymarket'
        AND source_match_id=ANY($1::text[]) ORDER BY platform,source_match_id`, [sourceIds]);
      assert.deepEqual(after, platforms.map(row => ({ ...row,
        match_id: ids.includes(Number(row.match_id)) ? null : row.match_id })), "Source data changed");
    }
    await client.query("COMMIT");
    return { readOnly: !apply, ids: rows.map(r => Number(r.id)), deleted: apply ? rows.length : 0,
      preservedSources: platforms.length, backup };
  }
  catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.every(arg => arg === "--apply"), "Only --apply is supported; default is read only");
  const { ensurePgPoolReady } = await import("@changmen/db");
  const pool = await ensurePgPoolReady(), client = await pool.connect();
  try {
    const result = await removeSingleVenueBasketball(client, {
      apply: args.includes("--apply"),
      saveBackup: async data => {
        const directory = fileURLToPath(new URL("../../output/basketball-single-cleanup/", import.meta.url));
        await mkdir(directory, { recursive: true });
        const file = path.join(directory, `backup-${Date.now()}.json`);
        await writeFile(file, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
        return file;
      },
    });
    console.log(JSON.stringify(result, null, 2));
  }
  finally { client.release(); await pool.end(); }
}

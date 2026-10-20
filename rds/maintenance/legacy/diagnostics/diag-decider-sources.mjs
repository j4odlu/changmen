#!/usr/bin/env node
/**
 * 决胜局 Sources 诊断：查 round=bo 的 client_matches，各 Map 行平台 Sources 键
 *   cd changmen/server/backend && node scripts/diag-decider-sources.mjs [id]
 */
import { ensurePgPoolReady } from "@changmen/db";

const pool = await ensurePgPoolReady();
if (!pool) {
  console.error("无 DATABASE_URL");
  process.exit(1);
}

const idArg = process.argv[2] ? Number(process.argv[2]) : null;

function summarizeBets(bets, round, bo) {
  const out = [];
  for (const b of bets || []) {
    const map = Number(b.Map) ?? 0;
    const keys = Object.keys(b.Sources || {}).sort();
    out.push({
      map,
      isLiveRow: round > 0 && map === round,
      sources: keys,
      name: b.Name,
    });
  }
  return out.sort((a, b) => a.map - b.map);
}

if (idArg) {
  const { rows } = await pool.query(
    `SELECT id, title, bo, round, reverse, matchs, bets, built_at
     FROM client_matches WHERE id = $1`,
    [idArg],
  );
  if (!rows.length) {
    console.log(`client_match #${idArg} 不存在`);
    process.exit(1);
  }
  const r = rows[0];
  console.log(JSON.stringify({
    id: r.id,
    title: r.title,
    bo: r.bo,
    round: r.round,
    reverse: r.reverse,
    ambiguous: null,
    matchs: r.matchs,
    bets: summarizeBets(r.bets, Number(r.round), Number(r.bo)),
    built_at: r.built_at,
  }, null, 2));
}
else {
  const { rows } = await pool.query(
    `SELECT id, title, bo, round, reverse, matchs, bets, built_at
     FROM client_matches
     WHERE round > 0 AND bo > 0 AND round = bo
     ORDER BY built_at DESC NULLS LAST
     LIMIT 10`,
  );
  console.log(`决胜局场次 (round=bo): ${rows.length}\n`);
  for (const r of rows) {
    const live = summarizeBets(r.bets, Number(r.round), Number(r.bo))
      .find(b => b.isLiveRow);
    console.log(`#${r.id} | ${r.title} | BO${r.bo} R${r.round}`);
    console.log(`  matchs: ${Object.keys(r.matchs || {}).join(", ")}`);
    console.log(`  reverse: ${JSON.stringify(r.reverse || [])}`);
    console.log(`  Map=${r.round} sources: ${(live?.sources || []).join(", ") || "(空)"}`);
    const map0 = summarizeBets(r.bets, Number(r.round), Number(r.bo)).find(b => b.map === 0);
    console.log(`  Map=0 sources: ${(map0?.sources || []).join(", ") || "(空)"}`);
    console.log("");
  }
}

await pool.end();

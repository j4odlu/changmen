#!/usr/bin/env node
/**
 * 阶段一 036 team_provider_ids 只读巡检（不写库）。
 *
 * 注意：036 文件自带 BEGIN/COMMIT，切勿在本脚本里再套外层事务
 *（嵌套 BEGIN 会被忽略，文件内 COMMIT 会提交整个外层事务 → 误落库）。
 *
 * 运行：node rds/maintenance/verify-team-provider-ids.mjs
 */
import { buildPgClientConfig, initDatabaseUrl } from "@changmen/db";
import pg from "@changmen/db/pg.js";

await initDatabaseUrl();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("缺少 DATABASE_URL");
  process.exit(1);
}

const client = new pg.Client(buildPgClientConfig(url, 30000));
client.on("error", (err) => console.warn("[verify] client error:", err.message));
await client.connect();

let exitCode = 0;

try {
  const { rows: exists } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'team_provider_ids') AS ok`,
  );
  if (!exists[0].ok) {
    console.error("[verify] ✘ team_provider_ids 表不存在（尚未执行 036）");
    process.exit(1);
  }

  const { rows: stats } = await client.query(
    `SELECT COUNT(*)::int AS n,
            COUNT(DISTINCT provider)::int AS providers
     FROM team_provider_ids`,
  );
  console.log(`[verify] team_provider_ids: ${stats[0].n} 行 / ${stats[0].providers} 个 provider`);

  const { rows: mismatch } = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM canonical_teams ct
     LEFT JOIN team_provider_ids tpi
       ON tpi.team_id = ct.id AND tpi.provider = 'pandascore'
     WHERE ct.pandascore_id IS NOT NULL AND tpi.provider_id IS NULL`,
  );
  console.log(`[verify] pandascore 回填缺失: ${mismatch[0].n} 行`);
  if (mismatch[0].n > 0) {
    console.error("[verify] ✘ 存在未回填的 pandascore_id");
    exitCode = 1;
  }

  const { rows: extra } = await client.query(
    `SELECT COUNT(*)::int AS n
     FROM team_provider_ids tpi
     LEFT JOIN canonical_teams ct ON ct.id = tpi.team_id
     WHERE ct.id IS NULL`,
  );
  console.log(`[verify] 孤儿 team_id: ${extra[0].n} 行`);
  if (extra[0].n > 0) {
    console.error("[verify] ✘ 存在指向不存在 canonical_teams 的 team_id");
    exitCode = 1;
  }

  const { rows: cols } = await client.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'team_provider_ids'
     ORDER BY ordinal_position`,
  );
  console.log("[verify] 表结构:", cols.map(c => `${c.column_name}:${c.data_type}`).join(", "));
}
catch (err) {
  console.error("[verify] ✘ 失败:", err.message);
  exitCode = 1;
}
finally {
  await client.end();
}

if (exitCode === 0)
  console.log("[verify] ✅ 036 巡检通过");
else
  console.error("[verify] ❌ 存在异常");
process.exit(exitCode);

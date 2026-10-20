import { createHash } from "node:crypto";

/** Historical SQL outer transactions are now owned by the runner and include their record. */
export function migrationBody(sql) {
  const begins = sql.match(/^BEGIN;\s*$/gm) || [];
  const commits = sql.match(/^COMMIT;\s*$/gm) || [];
  if (begins.length > 1 || commits.length > 1 || begins.length !== commits.length)
    throw new Error("迁移的外层事务声明不成对");
  return sql.replace(/^BEGIN;\s*$/m, "").replace(/^COMMIT;\s*$/m, "");
}

/** Explicit manifest only. Keep a session lock across all pending migrations. */
export async function runRdsMigrations(client, migrations, { readSql, beforeMigration = async () => {}, log = console.log } = {}) {
  const sources = migrations.map(name => {
    const sql = readSql(name);
    return { name, sql: migrationBody(sql), checksum: createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex") };
  });
  await client.query("SELECT pg_advisory_lock(hashtextextended('changmen:rds-schema',0))");
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS changmen_schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const previous = await client.query("SELECT name,checksum FROM changmen_schema_migrations");
    const applied = new Map(previous.rows.map(row => [row.name, row.checksum]));
    for (const source of sources) {
      if (applied.has(source.name) && applied.get(source.name) !== source.checksum)
        throw new Error(`已执行的迁移内容发生变化: ${source.name}`);
    }
    const completed = [];
    for (const source of sources) {
      if (applied.has(source.name)) continue;
      await client.query("BEGIN");
      try {
        await beforeMigration(client, source.name);
        log(`[rds] 执行 ${source.name} …`);
        await client.query(source.sql);
        await client.query("INSERT INTO changmen_schema_migrations(name,checksum) VALUES($1,$2)", [source.name, source.checksum]);
        await client.query("COMMIT");
        completed.push(source.name);
      }
      catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    }
    return completed;
  }
  finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended('changmen:rds-schema',0))");
  }
}

// Explicit, one-off maintenance. Never imported by application startup/release.
import assert from 'node:assert/strict';
import { readRdsMigrationSql } from './assets.mjs';
import { migrationBody } from './rds-migrations.mjs';
import { migrationChecksum, readRdsSchema, readSchemaBaseline, schemaDifferences } from './rds-schema-check.mjs';

export const RECONCILE_MIGRATION = '20261015_reconcile_archive_schema.sql';
export const RECONCILE_TABLES = ['client_matches_history', 'platform_matches_history', 'team_venue_maps'];

// Migration source precondition, NOT an alternative accepted by the checker.
// Only the reviewed source layout or the single final standard may be maintained.
export function reconciliationSourceSchema(target) {
  const source = structuredClone(target);
  const alter = (key, fields) => Object.assign(source.columns[key], fields);
  for (const table of RECONCILE_TABLES.slice(0, 2)) alter(`${table}.archived_at`, {
    type: 'bigint', default: '((EXTRACT(epoch FROM now()) * (1000)::numeric))::bigint',
  });
  alter('client_matches_history.id', { type: 'integer', notNull: false });
  for (const field of ['bo', 'round']) alter(`client_matches_history.${field}`, { type: 'smallint' });
  for (const field of ['title', 'built_at']) alter(`client_matches_history.${field}`, { notNull: false });
  alter('client_matches_history.reverse', { notNull: false, default: null });
  alter('platform_matches_history.match_id', { type: 'integer' });
  for (const field of ['home', 'away', 'synced_at', 'teams']) alter(`platform_matches_history.${field}`, { notNull: false });
  for (const [kind, from, to] of [
    ['constraints', 'team_venue_maps.team_venue_maps_gb_team_id_fkey', 'team_venue_maps.team_platform_maps_canonical_id_fkey'],
    ['constraints', 'team_venue_maps.team_venue_maps_pkey', 'team_venue_maps.team_platform_maps_pkey'],
    ['indexes', 'team_venue_maps.team_venue_maps_pkey', 'team_venue_maps.team_platform_maps_pkey'],
    ['sequences', 'team_venue_maps_id_seq', 'team_platform_maps_id_seq'],
  ]) {
    source[kind][to] = source[kind][from]; delete source[kind][from];
    if (kind === 'indexes') source[kind][to].definition = source[kind][to].definition.replace(
      'CREATE UNIQUE INDEX team_venue_maps_pkey ON', 'CREATE UNIQUE INDEX team_platform_maps_pkey ON');
  }
  return source;
}

/** Full-row multiset fingerprints, retaining duplicates and numeric precision. */
export async function reconciliationSnapshot(client, schema) {
  const tables = {};
  for (const table of RECONCILE_TABLES) {
    let row = 'to_jsonb(t)';
    if (table.endsWith('_history')) {
      const type = schema.columns[`${table}.archived_at`]?.type;
      assert(['bigint', 'timestamp with time zone'].includes(type), 'Unexpected archive time type');
      // Normalize numeric scale, never round: exact milliseconds match the old
      // bigint representation, while even a one-microsecond change stays visible.
      const time = type === 'bigint' ? 't.archived_at' : 'trim_scale(EXTRACT(epoch FROM t.archived_at)*1000)';
      row = `(to_jsonb(t)-'archived_at') || jsonb_build_object('archived_at_ms',${time})`;
    }
    tables[table] = (await client.query(`SELECT count(*)::text AS rows,
      md5(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),'')) AS digest
      FROM (SELECT md5((${row})::text) AS h FROM public.${table} t) s`)).rows[0];
  }
  const seq = (await client.query("SELECT pg_get_serial_sequence('public.team_venue_maps','id') AS name")).rows[0].name;
  assert(['public.team_platform_maps_id_seq', 'public.team_venue_maps_id_seq'].includes(seq), 'Unexpected identity sequence');
  const sequence = (await client.query(`SELECT last_value::text,is_called FROM ${seq}`)).rows[0];
  const sequenceOid = (await client.query('SELECT $1::regclass::oid::text AS oid', [seq])).rows[0].oid;
  return { tables, sequence: { ...sequence, oid: sequenceOid } };
}

/** Backup callback must durably store affected rows/schema before any ALTER. */
export async function reconcileRdsSchema(client, { apply = false, backup, sql = readRdsMigrationSql(RECONCILE_MIGRATION) } = {}) {
  const baseline = readSchemaBaseline(), checksum = migrationChecksum(sql);
  assert.equal(checksum, baseline.migrations[RECONCILE_MIGRATION], 'Unreviewed reconciliation SQL');
  if (apply && typeof backup !== 'function') throw new Error('Applying reconciliation requires a durable backup callback');
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s'; SET LOCAL idle_in_transaction_session_timeout='60s'; SET LOCAL search_path=public,pg_catalog; SET LOCAL timezone='UTC'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('changmen:rds-schema',0))");
    await client.query(`LOCK TABLE ${RECONCILE_TABLES.map(t => 'public.' + t).join(',')} IN ACCESS EXCLUSIVE MODE`);
    const actual = await readRdsSchema(client);
    const canonical = schemaDifferences(actual, baseline.schema).length === 0;
    const errors = schemaDifferences(actual, canonical ? baseline.schema : reconciliationSourceSchema(baseline.schema));
    if (errors.length) throw new Error(`Unreviewed migration source; no changes:\n${errors.join('\n')}`);
    const before = await reconciliationSnapshot(client, actual);
    // Inspect an existing ledger before DDL, without replaying/adopting old entries.
    const ledger = (await client.query("SELECT to_regclass('public.changmen_schema_migrations') AS name")).rows[0].name;
    if (ledger) {
      for (const record of (await client.query('SELECT name,checksum FROM public.changmen_schema_migrations')).rows) {
        if (baseline.migrations[record.name] && baseline.migrations[record.name] !== record.checksum)
          throw new Error(`Migration checksum changed: ${record.name}`);
      }
    }
    const backupReceipt = apply ? await backup(client, { schema: actual, before, migration: RECONCILE_MIGRATION, checksum }) : null;
    if (apply && !backupReceipt) throw new Error('Missing durable backup receipt');
    // Already canonical: do not rewrite tables or replay any migration.
    if (!canonical) await client.query(migrationBody(sql));
    const afterSchema = await readRdsSchema(client);
    const remaining = schemaDifferences(afterSchema, baseline.schema);
    if (remaining.length) throw new Error(`Canonical schema verification failed:\n${remaining.join('\n')}`);
    const after = await reconciliationSnapshot(client, afterSchema);
    assert.deepEqual(after, before, 'Reconciliation changed business data or sequence state');
    if (!canonical) {
      await client.query(`CREATE TABLE IF NOT EXISTS public.changmen_schema_migrations (
        name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`);
      await client.query('INSERT INTO public.changmen_schema_migrations(name,checksum) VALUES($1,$2) ON CONFLICT(name) DO NOTHING', [RECONCILE_MIGRATION, checksum]);
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    return { applied: apply && !canonical, dryRun: !apply, alreadyCanonical: canonical, migration: RECONCILE_MIGRATION,
      checksum, before, after, dataUnchanged: true, schemaDifferences: 0, backup: backupReceipt };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

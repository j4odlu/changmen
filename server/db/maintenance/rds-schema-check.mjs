import { createHash } from "node:crypto";
import { readRdsSchemaBaseline, listRdsMigrationNames, readRdsMigrationSql } from "./assets.mjs";

const normalize = text => text.replaceAll("\r\n", "\n");
export const migrationChecksum = sql => createHash("sha256").update(normalize(sql)).digest("hex");
export const readSchemaBaseline = readRdsSchemaBaseline;

/** Catalog reads only. Never inspect sequence last_value or any business rows. */
export async function readRdsSchema(client) {
  const queries = {
    tables: `SELECT c.relname AS key, jsonb_build_object('kind',c.relkind,'persistence',c.relpersistence,
      'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity) AS value
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname<>'changmen_schema_migrations'`,
    columns: `SELECT c.relname||'.'||a.attname AS key,
      jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
        'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) AS value
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
        AND c.relname<>'changmen_schema_migrations'`,
    constraints: `SELECT c.relname||'.'||p.conname AS key,
      jsonb_build_object('definition',pg_get_constraintdef(p.oid,false),'validated',p.convalidated) AS value
      FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND p.contype<>'n' AND c.relname<>'changmen_schema_migrations'`,
    indexes: `SELECT c.relname||'.'||i.relname AS key,
      jsonb_build_object('definition',pg_get_indexdef(i.oid),'valid',x.indisvalid,'ready',x.indisready) AS value
      FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class c ON c.oid=x.indrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname<>'changmen_schema_migrations'`,
    sequences: `SELECT c.relname AS key, jsonb_build_object('type',format_type(s.seqtypid,NULL),
      'start',s.seqstart::text,'increment',s.seqincrement::text,'min',s.seqmin::text,'max',s.seqmax::text,
      'cache',s.seqcache::text,'cycle',s.seqcycle) AS value
      FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public'`,
    functions: `SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS key,
      jsonb_build_object('body',p.prosrc,'result',pg_get_function_result(p.oid),'language',l.lanname,
        'volatility',p.provolatile,'securityDefiner',p.prosecdef,'config',p.proconfig) AS value
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname='public' AND p.prokind='f'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')`,
    triggers: `SELECT c.relname||'.'||t.tgname AS key,
      jsonb_build_object('definition',pg_get_triggerdef(t.oid,false),'enabled',t.tgenabled) AS value
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal`,
  };
  const schema = {};
  // One connection and transaction; no parallel queries on this client.
  for (const [kind, sql] of Object.entries(queries)) {
    const { rows } = await client.query(sql);
    schema[kind] = Object.fromEntries(rows.sort((a, b) => a.key.localeCompare(b.key, "en")).map(row => [row.key, row.value]));
  }
  return schema;
}

const canonical = value => value && typeof value === "object"
  ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  : typeof value === "string" ? normalize(value) : value;

/** Supplemental runtime tables/indexes are allowed; every numbered-schema requirement is checked. */
export function schemaDifferences(actual, expected) {
  const errors = [];
  for (const [kind, objects] of Object.entries(expected)) {
    for (const [key, value] of Object.entries(objects)) {
      if (!Object.hasOwn(actual[kind] || {}, key)) errors.push(`${kind}.${key}: missing`);
      else if (JSON.stringify(canonical(actual[kind][key])) !== JSON.stringify(canonical(value)))
        errors.push(`${kind}.${key}: incompatible; expected=${JSON.stringify(value)}, actual=${JSON.stringify(actual[kind][key])}`);
    }
  }
  return errors;
}

/** A successful check never runs historical SQL, creates a ledger, or writes business data. */
export async function verifyRdsSchema(client, { baseline = readSchemaBaseline(), log = console.log } = {}) {
  const names = listRdsMigrationNames();
  if (JSON.stringify(Object.keys(baseline.migrations).sort()) !== JSON.stringify(names))
    throw new Error("结构核验清单未覆盖全部编号迁移，请更新核验要求，禁止跳过结构检查");
  for (const [name, checksum] of Object.entries(baseline.migrations)) {
    const sql = readRdsMigrationSql(name);
    if (migrationChecksum(sql) !== checksum) throw new Error(`结构核验清单与历史迁移不一致: ${name}`);
  }
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL search_path = public, pg_catalog");
    const errors = schemaDifferences(await readRdsSchema(client), baseline.schema);
    if (errors.length) throw new Error(`数据库结构核验失败（只读，未自动修复）:\n${errors.join("\n")}`);
    const ledger = await client.query("SELECT to_regclass('public.changmen_schema_migrations') AS name");
    if (ledger.rows[0]?.name) {
      const records = await client.query("SELECT name,checksum FROM public.changmen_schema_migrations");
      for (const { name, checksum } of records.rows) {
        if (Object.hasOwn(baseline.migrations, name) && baseline.migrations[name] !== checksum)
          throw new Error(`已执行的迁移内容发生变化: ${name}`);
      }
    }
    await client.query("COMMIT");
    log("[rds] 数据库结构只读核验通过；未执行历史 SQL、未补写迁移账本");
    return { verified: true, readOnly: true, migrationsReplayed: 0 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

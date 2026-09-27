#!/usr/bin/env node
/**
 * 校验 RDS 迁移 SQL 是否覆盖 @changmen/db 代码里引用的表名（无需连库）。
 *
 *   cd changmen/server/backend && node scripts/ops/diagnostics/check-rds-schema.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "../../..");
const migrationsDir = join(backendRoot, "db", "migrations");
const dbPkgRoot = join(backendRoot, "..", "db");

const CODE_FILES = [
  join(dbPkgRoot, "impl_rds.js"),
  join(dbPkgRoot, "rds", "auth_store.js"),
  join(dbPkgRoot, "rds", "auth_session_store.js"),
  join(dbPkgRoot, "rds", "team_store.js"),
  join(dbPkgRoot, "rds", "matcher_store.js"),
];

// The checker intentionally scans whole source files because SQL is embedded in
// template strings. Ignore SQL grammar tokens and known prose/function matches
// that cannot be physical table names.
const IGNORED_IDENTIFIERS = new Set([
  "select",
  "where",
  "set",
  "and",
  "or",
  "not",
  "null",
  "true",
  "false",
  "as",
  "on",
  "using",
  "only",
  "any",
  "all",
  "case",
  "when",
  "then",
  "else",
  "end",
  "limit",
  "offset",
  "order",
  "by",
  "group",
  "having",
  "inner",
  "left",
  "right",
  "full",
  "cross",
  "natural",
  "distinct",
  "exists",
  "between",
  "like",
  "ilike",
  "is",
  "in",
  "values",
  "returning",
  "conflict",
  "excluded",
  "public",
  "cron",
  "job",
  "record",
  "moved",
  "failed",
  "unnest",
]);

function readText(path) {
  return readFileSync(path, "utf8");
}

function tablesFromMigrations() {
  const tables = new Set();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z]\w*)/gi;
  for (const name of readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort()) {
    const sql = readText(join(migrationsDir, name));
    for (const m of sql.matchAll(re)) {
      tables.add(m[1].toLowerCase());
    }
  }
  return tables;
}

function tablesFromCode() {
  const tables = new Set();
  const re = /\b(?:FROM|INTO|UPDATE|JOIN|DELETE\s+FROM)\s+([a-z]\w*)\b/gi;
  for (const file of CODE_FILES) {
    const src = readText(file);
    for (const m of src.matchAll(re)) {
      const name = m[1].toLowerCase();
      if (!IGNORED_IDENTIFIERS.has(name))
        tables.add(name);
    }
  }
  return tables;
}

function main() {
  const migrationTables = tablesFromMigrations();
  const codeTables = tablesFromCode();
  const missing = [...codeTables].filter(t => !migrationTables.has(t)).sort();

  if (missing.length) {
    console.error("[check-rds-schema] 代码引用的表缺少迁移定义:");
    for (const t of missing) console.error(`  - ${t}`);
    console.error(`迁移目录: ${migrationsDir}`);
    process.exit(1);
  }

  console.log(
    `[check-rds-schema] OK — ${codeTables.size} 张代码表均已覆盖（迁移共 ${migrationTables.size} 张表）`,
  );
}

main();

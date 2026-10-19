import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTROL_COLUMNS } from "./plan.mjs";
import { gitSource } from "../../verification/fok-exact-boundaries.mjs";
import { retirementBase } from "../../verification/gtc-compat-retirement.mjs";

const read = file => fs.readFileSync(file, "utf8");
const schema = read("scripts/migrations/pm-gtc-orders/phase2-schema.sql");
const rollback = read("scripts/migrations/pm-gtc-orders/phase2-rollback.sql");

describe("reviewable migration boundaries, without executing any DDL", () => {
  it("keeps the old table and finance columns, and leaves every old order ready by default", () => {
    expect(schema).toContain("financial_ready boolean NOT NULL DEFAULT true");
    for (const column of CONTROL_COLUMNS)
      expect(schema).toContain(`ADD COLUMN IF NOT EXISTS ${column} `);
    expect(schema).not.toMatch(/(?:DROP|ALTER|UPDATE|DELETE FROM|INSERT INTO) (?:TABLE )?(?:public\.)?pm_gtc_executions/i);
    expect(schema).not.toMatch(/UPDATE (?:public\.)?orders\b/i);
    expect(schema).not.toMatch(/ALTER COLUMN (?:bet_money|money|status|raw|order_id|player_id)/i);
  });
  it("has a bounded atomic DDL transaction and shared migration lock", () => {
    for (const sql of [schema, rollback]) {
      expect(sql).toContain("BEGIN;");
      expect(sql.trim().endsWith("COMMIT;")).toBe(true);
      expect(sql).toContain("lock_timeout = '5s'");
      expect(sql).toContain("statement_timeout = '60s'");
      expect(sql).toContain("hashtextextended('pm-gtc-orders-schema-v1',0)");
    }
  });
  it("complete identity validation refuses NULL loopholes and false financial rows without control", () => {
    expect(schema).toContain("AND record IS NULL AND updated IS NULL AND ready");
    expect(schema).toContain(") IS TRUE");
    expect(schema).toContain("lower(record->>'id')=eid::text");
    expect(schema).toContain("lower(record->>'owner')=owner::text");
    expect(schema).toContain("record->>'walletKey'=wallet");
    expect(schema).toContain("record->'plan'->>'playerId'=player::text");
    expect(schema).toContain("lower(oid)=lower(record->'plan'->>'orderHash')");
    expect(schema).toContain("active=NOT (record->>'released')::boolean");
  });
  it("financial view keeps the legacy column set and filters before consumers", () => {
    const view = schema.slice(schema.indexOf("CREATE OR REPLACE VIEW"), schema.indexOf("-- 旧运维"));
    expect(view).toContain("FROM public.orders WHERE financial_ready");
    expect(view).toContain("WITH LOCAL CHECK OPTION");
    expect(view).not.toMatch(/execution_record|execution_id|SELECT \*/);
  });
  it("database delete protection applies to hard deletes and cascades, with no trading UPDATE trigger", () => {
    expect(schema).toContain("IF OLD.execution_id IS NOT NULL THEN");
    expect(schema).toContain("RAISE EXCEPTION 'orders execution control must be retained");
    expect(schema).toContain("BEFORE DELETE ON public.orders");
    expect(schema).not.toMatch(/(?:BEFORE|AFTER) (?:INSERT|UPDATE)/);
  });
  it("rollback checks every control column and pending readiness under a table lock before dropping anything", () => {
    const guard = rollback.slice(0, rollback.indexOf("DROP FUNCTION"));
    expect(guard).toContain("LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE");
    expect(guard).toContain("NOT financial_ready");
    for (const column of CONTROL_COLUMNS)
      expect(guard).toContain(`${column} IS NOT NULL`);
    expect(guard).toContain("RAISE EXCEPTION");
    expect(rollback).not.toMatch(/DROP[^;]*CASCADE/);
  });
  it("startup schema verification checks types, readiness default, valid indexes/constraints, view and delete trigger", () => {
    for (const gate of ["a.atttypid=expected.typ::regtype", "a.attnotnull", "pg_get_expr(d.adbin,d.adrelid)='true'", "convalidated", "i.indisvalid AND i.indisready", "pg_get_indexdef(c.oid)=expected.definition", "tgenabled='O'", "pg_get_viewdef", "check_option=local"])
      expect(schema).toContain(gate);
  });
  it("has no automatic integration with startup/deployment DDL", () => {
    expect(read("server/db/maintenance/apply-rds-schema.mjs")).not.toContain("phase2-schema");
    expect(read("server/backend/server.js")).not.toContain("phase2-schema");
    expect(gitSource(retirementBase, "server/db/rds/orders_execution_compat.js")).not.toMatch(/(?:CREATE|ALTER|DROP) (?:TABLE|VIEW|FUNCTION)/);
    expect(read("server/db/rds/native_orders.js")).not.toMatch(/(?:CREATE|ALTER|DROP) (?:TABLE|VIEW|FUNCTION)/);
  });
  it("historical schema validation preceded startup; current startup has no retired mode", () => {
    const startup = gitSource(retirementBase, "server/backend/server.js");
    const validated = startup.indexOf("await ensurePgPoolReady()");
    expect(validated).toBeGreaterThan(0);
    for (const later of ["setupAdminTools();", "ensurePlatformCredentials()", "server.listen("])
      expect(validated).toBeLessThan(startup.indexOf(later));
    expect(read("server/backend/server.js")).not.toMatch(/ORDERS_EXECUTION_COMPAT|PM_ORDERS_MINIMAL|ensurePgPoolReady/);
  });
});

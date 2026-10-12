import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { applyGtcCommand } from "@changmen/shared/pm_gtc";
import picomatch from "picomatch";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { configDefaults } from "vitest/config";
import { resolveGtcFinancialOrder } from "../../../../server/db/rds/orderModes/gtc/pm_gtc_financial.js";
import { accepted, facts, financialRow, HASH } from "./fixtures.mjs";
import { EXECUTION_TOKEN, isolatedConnection, TEST_DATABASE, TEST_MARKER, TEST_ROLE, verifyIsolatedDatabase } from "./guard.mjs";
import config from "./postgres.config.mjs";

const file = "scripts/migrations/pm-gtc-orders/integration/postgres.integration.mjs";
const read = name => fs.readFileSync(new URL(name, import.meta.url), "utf8");
const goodUrl = `postgresql://${TEST_ROLE}:test-only-password@127.0.0.1:55432/${TEST_DATABASE}`;
const databaseRow = { database: TEST_DATABASE, role: TEST_ROLE, address: "127.0.0.1", version: 150000, marker: TEST_MARKER, rolsuper: false, rolcreatedb: false, rolcreaterole: false };

describe("offline isolated PostgreSQL test preparation (no database connection)", () => {
  it.each(["127.0.0.1", "localhost", "[::1]"])("allows only the dedicated loopback connection: %s", (host) => {
    expect(isolatedConnection(goodUrl.replace("127.0.0.1", host), EXECUTION_TOKEN)).toMatchObject({ ssl: false, max: 8, lock_timeout: 3000, statement_timeout: 8000 });
  });
  it.each([
    undefined,
    "",
    "not-a-url",
    goodUrl.replace("127.0.0.1", "rds.example.com"),
    goodUrl.replace(TEST_DATABASE, "changmen"),
    goodUrl.replace(TEST_ROLE, "postgres"),
    `${goodUrl}?host=rds.example.com`,
    `${goodUrl}?sslmode=require`,
    `${goodUrl}#fragment`,
    goodUrl.replace("postgresql:", "https:"),
    goodUrl.replace("55432", "65536"),
  ])("rejects missing or non-isolated connection %s", (value) => {
    expect(() => isolatedConnection(value, EXECUTION_TOKEN)).toThrow();
  });
  it.each([undefined, "", "1", "execute"])("rejects implicit execution token %s even for a valid test URL", (token) => {
    expect(() => isolatedConnection(goodUrl, token)).toThrow("显式执行入口");
  });
  it("checks the real server identity before SQL and returns no credentials", async () => {
    const query = vi.fn(async () => ({ rows: [databaseRow] }));
    await verifyIsolatedDatabase({ query });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0]).toContain("inet_server_addr()");
    // PostgreSQL inet::text includes /32 or /128; host() returns the exact address.
    expect(query.mock.calls[0][0]).toContain("host(inet_server_addr()) AS address");
    expect(query.mock.calls[0][0]).not.toMatch(/CREATE|ALTER|DROP|DELETE|INSERT|TRUNCATE/);
  });
  it.each([
    ["database", "changmen"],
    ["role", "postgres"],
    ["address", "10.0.0.1"],
    ["address", null],
    ["marker", null],
    ["marker", "production"],
    ["version", 130000],
    ["version", undefined],
    ["version", "150000"],
    ["rolsuper", true],
    ["rolcreatedb", true],
    ["rolcreaterole", true],
  ])("refuses incorrect real server %s=%s", async (key, value) => {
    await expect(verifyIsolatedDatabase({ query: async () => ({ rows: [{ ...databaseRow, [key]: value }] }) })).rejects.toThrow("验证失败");
  });
  it("rejects a missing server identity row", async () => {
    await expect(verifyIsolatedDatabase({ query: async () => ({ rows: [] }) })).rejects.toThrow();
  });
  it.each([{ args: [] }, { args: ["--plan"] }])("default/plan CLI never connects, reads production credentials, or claims database acceptance: %s", ({ args }) => {
    const result = spawnSync(process.execPath, ["scripts/migrations/pm-gtc-orders/integration/run.mjs", ...args], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "postgres://production-secret@invalid.example.com/changmen", PM_GTC_TEST_DATABASE_URL: goodUrl, PM_GTC_TEST_EXECUTION_TOKEN: EXECUTION_TOKEN },
    });
    expect(result.status).toBe(0);
    const plan = JSON.parse(result.stdout);
    expect(plan).toMatchObject({ mode: "plan", databaseConnected: false, sqlExecuted: false, databaseIntegrationAccepted: false });
    expect(result.stdout + result.stderr).not.toContain("production-secret");
    expect(result.stdout + result.stderr).not.toContain("test-only-password");
  });
  it.each([{ args: ["--apply"] }, { args: ["--execute-isolated", "--plan"] }, { args: ["--url", goodUrl] }])("cLI rejects unknown or ambiguous execution options %s", ({ args }) => {
    const result = spawnSync(process.execPath, ["scripts/migrations/pm-gtc-orders/integration/run.mjs", ...args], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
  });
  it("execution CLI rejects a production URL before spawning Vitest without printing credentials", () => {
    const result = spawnSync(process.execPath, ["scripts/migrations/pm-gtc-orders/integration/run.mjs", "--execute-isolated"], {
      encoding: "utf8",
      env: { ...process.env, PM_GTC_TEST_DATABASE_URL: "postgres://production-secret@rds.example.com/changmen" },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("production-secret");
  });
  it("real suite is excluded from default discovery and included only in its dedicated serial config", () => {
    expect(configDefaults.include.some(pattern => picomatch(pattern)(file))).toBe(false);
    expect(config.test.include).toEqual([file]);
    expect(config.test.fileParallelism).toBe(false);
    expect(config.test.maxWorkers).toBe(1);
    const source = read("postgres.integration.mjs");
    expect(source.indexOf("await verifyIsolatedDatabase(pool)")).toBeLessThan(source.indexOf("await pool.query(read(\"bootstrap.sql\"))"));
    expect(source).toContain("process.env.PM_GTC_TEST_EXECUTION_TOKEN");
  });
  it("test provisioning/bootstrap/reset scripts cannot target ordinary databases or hide destructive cleanup", () => {
    for (const name of ["create-test-db.sql", "bootstrap.sql"]) {
      const source = read(name);
      expect(source).toContain("inet_server_addr()");
      expect(source).toContain(TEST_DATABASE);
      expect(source).toContain(TEST_ROLE);
      expect(source).not.toMatch(/DROP DATABASE|DROP ROLE|DROP[^;]*CASCADE|IF NOT EXISTS/);
    }
    expect(read("bootstrap.sql")).toContain("test bootstrap requires empty public schema");
    expect(read("reset-fixtures.sql").indexOf("assert_pm_gtc_phase2_test_database()")).toBeLessThan(read("reset-fixtures.sql").indexOf("TRUNCATE"));
    expect(read("reset-fixtures.sql")).not.toMatch(/CASCADE|DROP/);
  });
  it("real suite uses original writer/DDL and only replaces the database entry point", () => {
    const source = read("postgres.integration.mjs");
    expect(source.match(/vi\.mock\(/g)).toHaveLength(1);
    expect(source).toContain("value.query(sql, params)");
    expect(source).toContain("pool.query(read(\"../phase2-schema.sql\"))");
    expect(source).toContain("mutatePmGtc(");
    expect(source).toContain("pg_blocking_pids");
    expect(source).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(source).not.toContain("mockResolvedValue");
    for (const name of ["run.mjs", "guard.mjs"])
      expect(read(name)).not.toMatch(/dotenv|readFile[^;]*\.env\b|process\.env\.DATABASE_URL|auth_login|ALLOW_ESPORT_TOUCH/);
  });
  it("minimal orders fixture matches baseline types/defaults/identity/FK plus the original changmen_bet extension", () => {
    const baseline = fs.readFileSync("server/backend/db/migrations/001_baseline.sql", "utf8");
    const original = baseline.match(/CREATE TABLE IF NOT EXISTS orders\s*\(([\s\S]*?)\n\);/)[1];
    const fixture = read("bootstrap.sql").match(/CREATE TABLE public\.orders\s*\(([\s\S]*?)\n\);/)[1];
    const normalized = sql => sql.replaceAll("public.", "").replace(/\s+/g, "").toLowerCase();
    expect(normalized(fixture).replace(",changmen_betbooleannotnulldefaultfalse", "")).toBe(normalized(original));
    expect(fs.readFileSync("server/backend/db/migrations/009_orders_changmen_bet.sql", "utf8")).toContain("changmen_bet boolean NOT NULL DEFAULT false");
  });
  it("fixture facts qualify under the original financial helper without changing money rules", () => {
    const command = facts();
    const execution = applyGtcCommand(accepted(), command, Date.now());
    expect(resolveGtcFinancialOrder(execution, command.financialOrder)).toEqual(command.financialOrder);
    expect(execution).toMatchObject({ matched: "5", principal: "2.5", fee: "0" });
    expect(financialRow(HASH).bet_money).toBe(command.financialOrder.betMoney);
    expect(execution.testUnknownExtension).toEqual({ preserved: ["unknown", 1] });
  });
  it("checklist enumerates every real PostgreSQL case and distinguishes historical acceptance from production readiness", () => {
    const source = read("postgres.integration.mjs");
    const checklist = read("ACCEPTANCE.md");
    const ids = new Set(source.match(/PG-\d+/g));
    expect(ids.size).toBe(40);
    for (const id of ids) expect(checklist).toContain(id);
    expect(checklist).toContain("生产");
    expect(checklist).toContain("40/40");
    expect(checklist).toContain("首单截止窗口");
  });
  it("real execution acceptance requires all 64 registered cases, without skip or only", () => {
    const source = read("postgres.integration.mjs");
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    let count = 0;
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        if (ts.isIdentifier(callee) && callee.text === "it")
          count++;
        if (ts.isCallExpression(callee) && callee.expression.getText(tree) === "it.each") {
          expect(ts.isArrayLiteralExpression(callee.arguments[0])).toBe(true);
          count += callee.arguments[0].elements.length;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    expect(count).toBe(64);
    expect(source).not.toMatch(/\b(?:it|describe)\.(?:skip|only|todo|skipIf|runIf)\b/);
    expect(read("run.mjs")).toContain("report.numPassedTests === 64");
    expect(read("run.mjs")).toContain("report.numPendingTests === 0");
  });
});

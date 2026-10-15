import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { RDS_MIGRATIONS } from "./apply-rds-schema.mjs";
import { migrationBody, runRdsMigrations } from "./rds-migrations.mjs";

describe("RDS migration manifest and records", () => {
  it("covers every active numbered migration, including 034 and 039", () => {
    const names = readdirSync(new URL("../db/migrations/", import.meta.url))
      .filter(name => /^\d+_.*\.sql$/.test(name) && name !== "002_prune_pg_cron.sql").sort();
    expect(RDS_MIGRATIONS).toEqual(names);
    for (const name of names)
      expect(() => migrationBody(readFileSync(new URL(`../db/migrations/${name}`, import.meta.url), "utf8"))).not.toThrow();
  });

  it("records each migration in the same transaction and releases the session lock", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await runRdsMigrations({ query }, ["001_test.sql"], { readSql: () => "BEGIN;\nSELECT 1;\nCOMMIT;", log: () => {} });
    const calls = query.mock.calls.map(call => call[0]);
    expect(calls[0]).toContain("pg_advisory_lock");
    expect(calls.slice(3, -1)).toEqual(["BEGIN", "\nSELECT 1;\n", "INSERT INTO changmen_schema_migrations(name,checksum) VALUES($1,$2)", "COMMIT"]);
    expect(calls.at(-1)).toContain("pg_advisory_unlock");
  });

  it("rolls back a failed migration without recording success", async () => {
    const query = vi.fn(async sql => {
      if (sql === "broken SQL") throw new Error("injected migration failure");
      return { rows: [] };
    });
    await expect(runRdsMigrations({ query }, ["001_test.sql"], { readSql: () => "broken SQL", log: () => {} }))
      .rejects.toThrow("injected migration failure");
    expect(query.mock.calls.map(call => call[0])).toContain("ROLLBACK");
    expect(query.mock.calls.some(call => call[0].startsWith("INSERT INTO"))).toBe(false);
    expect(query.mock.calls.at(-1)[0]).toContain("pg_advisory_unlock");
  });

  it("skips an unchanged migration and refuses changed history before applying anything", async () => {
    const checksum = createHash("sha256").update("SELECT 1;").digest("hex");
    const query = vi.fn(async sql => ({ rows: sql.startsWith("SELECT name") ? [{ name: "001_test.sql", checksum }] : [] }));
    expect(await runRdsMigrations({ query }, ["001_test.sql"], { readSql: () => "SELECT 1;" })).toEqual([]);
    query.mockClear();
    await expect(runRdsMigrations({ query }, ["001_test.sql", "002_test.sql"], { readSql: () => "SELECT 2;" }))
      .rejects.toThrow("已执行的迁移内容发生变化");
    expect(query.mock.calls.some(call => call[0] === "BEGIN")).toBe(false);
  });
});

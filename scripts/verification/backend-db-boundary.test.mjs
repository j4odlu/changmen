import { describe, expect, it } from "vitest";
import { databaseAccessSites, unregisteredDatabaseSites } from "./backend-db-boundary.mjs";

const file = "server/backend/core/account/new_service.js";
describe("backend database boundary", () => {
  it.each([
    'import { getPgPool as pool } from "@changmen/db"; pool();',
    'import * as db from "@changmen/db"; db.getPgPool();',
    'import * as db from "@changmen/db"; db["getPgPool"]();',
    'import * as db from "@changmen/db"; db[method]();',
    'import * as db from "@changmen/db"; const {getPgPool: pool} = db;',
    'import * as db from "@changmen/db"; const pool = db.getPgPool;',
    'const db = await import("@changmen/db");',
    'const db = require("@changmen/db");',
    'import { Pool as Connection } from "pg";',
    'import { getPgPool } from "../../../db/rds/common.js";',
    'import { getPgPool } from "@changmen/db/pg_pool.js";',
    'export { getPgPool as connect } from "@changmen/db";',
    'export * from "@changmen/db";',
    'export * from "../../../db/rds/common.js";',
    'const pool = getConnection(); await pool.query("SELECT 1");',
    'await db["query"]("SELECT 1");',
    'const execute = pool.query; execute("SELECT 1");',
    'const { query: execute } = pool; execute("SELECT 1");',
    'import { getPgPool as connect } from "@changmen/db/public_bridge.js";',
    'import { createRequire as make } from "node:module"; const load = make(import.meta.url); const pg = load("pg");',
    'const load = require; const pg = load("pg");',
    'const execute = pool["query"]; execute("SELECT 1");',
  ])("rejects direct and indirect storage access: %s", source => {
    expect(unregisteredDatabaseSites(databaseAccessSites(file, source), [])).not.toHaveLength(0);
  });
  it("allows domain ports, public operations, ordinary strings and comments", () => {
    expect(databaseAccessSites(file, `
      import { fetchProfileById } from "@changmen/db";
      import * as users from "@changmen/db/admin_users.js";
      await users.readManagedUserIdentity("u");
      // pool.query('SELECT 1')
      const explanation = "getPgPool query SELECT";
    `)).toEqual([]);
  });
  it("does not mistake template SQL or comments for imports", () => {
    expect(databaseAccessSites(file, 'const text = `import {getPgPool} from "@changmen/db"`;')).toEqual([]);
  });
  it("allows reducing historical sites but rejects added, changed and moved sites", () => {
    const old = databaseAccessSites(file, 'function read(){ return pool.query("SELECT 1"); }');
    expect(unregisteredDatabaseSites([], old)).toEqual([]);
    expect(unregisteredDatabaseSites(old, old)).toEqual([]);
    expect(unregisteredDatabaseSites([...old, ...old], old)).toHaveLength(1);
    expect(unregisteredDatabaseSites(databaseAccessSites(file, 'function read(){ return pool.query("DELETE FROM users"); }'), old)).toHaveLength(1);
    expect(unregisteredDatabaseSites(old.map(s => ({ ...s, file: "server/backend/core/other.js" })), old)).toHaveLength(1);
    expect(unregisteredDatabaseSites(databaseAccessSites(file, 'function other(){ return pool.query("SELECT 1"); }'), old)).toHaveLength(1);
  });
  it.each(["server/backend/core/account/admin_service.js", "server/backend/core/esport-api/value_bet_service.js", "server/backend/core/esport-api/sport_predictfun_fetch.js"])("never accepts an exception for an already migrated consumer: %s", file => {
    const sites = databaseAccessSites(file, 'db.query("SELECT 1");');
    expect(unregisteredDatabaseSites(sites, sites)).toEqual(sites);
  });
  it("treats Windows checkout line endings as the same historical source", () => {
    const source = 'async function read(){\n await pool.query(`SELECT\n1`);\n}';
    expect(databaseAccessSites(file, source.replaceAll("\n", "\r\n"))).toEqual(databaseAccessSites(file, source));
  });
});

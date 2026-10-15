// [changmen 扩展] Explicit integration check using a disposable local cluster.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "@changmen/db/pg.js";
import { withTemporaryPostgres } from "./test-support/temporary-postgres.mjs";
import { readSchemaBaseline, verifyRdsSchema } from "../../server/backend/scripts/rds-schema-check.mjs";

await withTemporaryPostgres(async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const baseline = readSchemaBaseline();
    for (const name of Object.keys(baseline.migrations))
      await client.query(readFileSync(new URL(`../../server/backend/db/migrations/${name}`, import.meta.url), "utf8"));
    await client.query(readFileSync(new URL("../../server/db/schema/client_certificates.sql", import.meta.url), "utf8"));
    await client.query("CREATE TABLE deployment_test_sentinel (id integer PRIMARY KEY, payload jsonb NOT NULL)");
    await client.query("INSERT INTO deployment_test_sentinel VALUES (1, $1)", [{ balance: 200, token: "synthetic-current-token" }]);
    const queries = [];
    const observed = { async query(sql, values) { queries.push(sql); return client.query(sql, values); } };
    const before = (await client.query("SELECT * FROM deployment_test_sentinel")).rows;
    const result = await verifyRdsSchema(observed, { log: () => {} });
    assert.equal(result.readOnly, true);
    assert.equal(result.migrationsReplayed, 0);
    assert.deepEqual(result.compatibility, []);
    assert.deepEqual((await client.query("SELECT * FROM deployment_test_sentinel")).rows, before);
    for (const sql of queries) assert.match(sql, /^(SELECT |BEGIN |SET LOCAL |COMMIT$)/);
    // Prove PostgreSQL itself enforces the verifier's read-only transaction.
    const injected = { async query(sql) {
      const response = await client.query(sql);
      if (sql.startsWith("BEGIN ")) await client.query("DELETE FROM deployment_test_sentinel");
      return response;
    } };
    await assert.rejects(verifyRdsSchema(injected, { log: () => {} }), { code: "25006" });
    await client.query("ROLLBACK");
    assert.deepEqual((await client.query("SELECT * FROM deployment_test_sentinel")).rows, before);
    await client.query("ALTER TABLE players DROP CONSTRAINT players_active_requires_owner");
    await assert.rejects(verifyRdsSchema(client, { log: () => {} }), /players_active_requires_owner/);
    console.log("PASS: real PostgreSQL canonical schema, read-only enforcement, data preservation, missing constraint rejection");
  } finally { await client.end(); }
});

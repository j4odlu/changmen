import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(here, "../backend/db/migrations/042_pod_bet_executions.sql"), "utf8");
const rayMigration = readFileSync(join(here, "../backend/db/migrations/045_pod_ray_execution.sql"), "utf8");
const store = readFileSync(join(here, "rds/pod_bet_execution_store.js"), "utf8");
const service = readFileSync(join(here, "../backend/core/football/football_order_service.js"), "utf8");
const routes = readFileSync(join(here, "../backend/core/esport-api/football_order_routes.js"), "utf8");
const apply = readFileSync(join(here, "../backend/scripts/apply-rds-schema.mjs"), "utf8");

assert.match(migration, /UNIQUE \(user_id, alert_id, venue, player_id\)/);
assert.match(migration, /CHECK \(state IN \('reserved', 'accepted', 'failed', 'unknown'\)\)/);
assert.match(migration, /ALTER COLUMN lease_until SET DEFAULT 0/);
assert.match(store, /ON CONFLICT \(user_id, alert_id, venue, player_id\) DO NOTHING/);
assert.match(store, /state = 'reserved'/);
assert.doesNotMatch(store, /lease_until\s*</);
assert.match(service, /randomUUID\(\)/);
assert.match(service, /assertPlayerOwnedByUser/);
assert.match(routes, /Client_ReservePodBet/);
assert.match(routes, /Client_FinalizePodBet/);
assert.match(apply, /042_pod_bet_executions\.sql/);
assert.match(apply, /045_pod_ray_execution\.sql/);
assert.match(rayMigration, /CHECK \(venue IN \('OB', 'Polymarket', 'RAY'\)\)/);
assert.match(store, /CHECK \(venue IN \('OB', 'Polymarket', 'RAY'\)\)/);
assert.match(store, /DO \$\$ BEGIN[\s\S]*END \$\$/);

console.log("pod_bet_execution.smoke: ok");

/**
 * 足球订单表与电竞 orders 隔离。不依赖 DATABASE_URL。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const storeSrc = readFileSync(join(__dirname, "rds/football_orders_store.js"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const serviceSrc = readFileSync(
  join(__dirname, "../backend/core/football/football_order_service.js"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const routesSrc = readFileSync(
  join(__dirname, "../backend/core/esport-api/football_order_routes.js"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const accountRoutes = readFileSync(
  join(__dirname, "../backend/core/esport-api/account_client_routes.ts"),
  "utf8",
);
const migration = readFileSync(
  join(__dirname, "../backend/db/migrations/040_football_orders.sql"),
  "utf8",
);
const apply = readFileSync(join(__dirname, "../backend/scripts/apply-rds-schema.mjs"), "utf8");
const monthReport = readFileSync(
  join(__dirname, "../backend/core/football/football_month_report.js"),
  "utf8",
);
const esportReport = readFileSync(
  join(__dirname, "../backend/core/account/report_service.js"),
  "utf8",
);
const webStore = readFileSync(
  join(__dirname, "../../client/web/src/stores/footballOrderStore.ts"),
  "utf8",
);

function sqlTableHits(src, table) {
  const re = new RegExp(String.raw`(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+${table}\b`, "gi");
  return re.test(src);
}

assert.match(storeSrc, /fetchFootballOrdersForMonthAggregate/);
assert.match(storeSrc, /FROM football_orders/);
assert.match(storeSrc, /placed_at >=/);
assert.match(storeSrc, /patchFootballOrderStatus/);
assert.match(storeSrc, /ADD COLUMN IF NOT EXISTS status/);
assert.match(storeSrc, /ADD COLUMN IF NOT EXISTS profit/);
assert.match(storeSrc, /Number\(opts\.limit\) \|\| 1024/);
assert.match(serviceSrc, /fetchFootballOrdersByUser\(userId, \{ date, limit: 1024 \}\)/);
assert.equal(sqlTableHits(storeSrc, "orders"), false, "football_orders_store 不得 SQL 引用电竞 orders");
assert.equal(sqlTableHits(storeSrc, "client_matches"), false);
assert.doesNotMatch(serviceSrc, /order_store|admin_orders|upsertOrders|Client_SaveOrder/);
assert.doesNotMatch(routesSrc, /account_client_routes|Client_SaveOrder|Client_GetOrderList/);
assert.match(routesSrc, /Client_SaveFootballOrder/);
assert.match(routesSrc, /Client_GetFootballOrders/);
assert.doesNotMatch(accountRoutes, /Client_SaveFootballOrder|Client_GetFootballOrders|football_orders/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS football_orders/);
assert.match(migration, /status\s+text NOT NULL DEFAULT 'None'/);
assert.doesNotMatch(migration, /REFERENCES orders\b/);
assert.match(apply, /040_football_orders\.sql/);
assert.match(apply, /041_football_orders_status\.sql/);
const migration041 = readFileSync(
  join(__dirname, "../backend/db/migrations/041_football_orders_status.sql"),
  "utf8",
);
assert.match(migration041, /ADD COLUMN IF NOT EXISTS status/);
assert.match(migration041, /ADD COLUMN IF NOT EXISTS profit/);
assert.doesNotMatch(webStore, /localStorage\.(getItem|setItem|removeItem)/);
assert.doesNotMatch(webStore, /from ["']@\/stores\/orderStore/);
assert.doesNotMatch(webStore, /"Client_SaveOrder"|"Client_GetOrderList"/);
assert.match(monthReport, /fetchFootballOrdersForMonthAggregate/);
assert.doesNotMatch(monthReport, /(?<!Football)fetchOrdersForMonthAggregate|fetchMoneyLogsForMonthAggregate|account\/report_service/);
assert.match(esportReport, /fetchOrdersForMonthAggregate/);
assert.match(esportReport, /fetchMoneyLogsForMonthAggregate/);
assert.doesNotMatch(esportReport, /football_orders|fetchFootballOrders/);

console.log("football_orders.smoke: ok");

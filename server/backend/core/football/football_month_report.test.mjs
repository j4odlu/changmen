/**
 * 足球月报聚合。不读电竞 orders / money_logs。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateFootballMonthRows } from "./football_month_report.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const jun13 = new Date(2026, 5, 13, 10, 0, 0).getTime();
const jun14 = new Date(2026, 5, 14, 12, 0, 0).getTime();
const jun15 = new Date(2026, 5, 15, 9, 0, 0).getTime();

const report = aggregateFootballMonthRows("2026-06", [
  { placed_at: jun13, venue: " ob ", stake: 100, profit: 80, status: "Win" },
  { placed_at: jun13, stake: 50, profit: 0, status: "Pending" },
  { placed_at: jun13, stake: 999, profit: 10, status: "Reject" },
  { placed_at: jun14, stake: 200, profit: -200, status: "Lose" },
  { placed_at: jun15, stake: 40, profit: 0, status: "None" },
  { placed_at: jun13, venue: "Polymarket", stake: 500, profit: 400, status: "Win" },
  { placed_at: jun14, venue: "IM", stake: 300, profit: -300, status: "Lose" },
]);

assert.equal(report.month, "2026-06");
assert.equal(report.list.length, 30);

const day13 = report.list.find(r => r.Date === "2026-06-13");
assert.equal(day13.OrderCount, 2);
assert.equal(day13.BetMoney, 150);
assert.equal(day13.Profit, 80);
assert.equal(day13.Rate, 80 / 150);
assert.equal(day13.Deposit, undefined);
assert.equal(day13.Hacked, undefined);

const day14 = report.list.find(r => r.Date === "2026-06-14");
assert.equal(day14.OrderCount, 1);
assert.equal(day14.BetMoney, 200);
assert.equal(day14.Profit, -200);

const day15 = report.list.find(r => r.Date === "2026-06-15");
assert.equal(day15.OrderCount, 1);
assert.equal(day15.BetMoney, 40);
assert.equal(day15.Profit, 0);

assert.equal(report.total.OrderCount, 4);
assert.equal(report.total.BetMoney, 390);
assert.equal(report.total.Profit, -120);

const src = readFileSync(join(__dirname, "football_month_report.js"), "utf8");
assert.match(src, /fetchFootballOrdersForMonthAggregate/);
assert.doesNotMatch(src, /(?<!Football)fetchOrdersForMonthAggregate|fetchMoneyLogsForMonthAggregate|account\/report_service/);
assert.doesNotMatch(src, /FROM orders\b|INTO orders\b/);

const esportReport = readFileSync(join(__dirname, "../account/report_service.js"), "utf8");
assert.match(esportReport, /fetchOrdersForMonthAggregate/);
assert.match(esportReport, /fetchMoneyLogsForMonthAggregate/);
assert.doesNotMatch(esportReport, /football_orders|fetchFootballOrders/);

console.log("football_month_report: ok");

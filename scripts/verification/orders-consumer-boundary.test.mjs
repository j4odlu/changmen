import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { gitSource, verifyProtectedSource } from "./orders-phase2-release-boundary.mjs";
import { ordersCompatPath, verifyOrdersCompatHelper } from "./orders-consumer-boundary.mjs";
import { retirementBase, retiredHelpers } from "./gtc-compat-retirement.mjs";

const path = "server/db/rds/orders_store.js";
const read = file => fs.readFileSync(file, "utf8");
describe("whole FOK order writer and finance protection retain fixed original baselines", () => {
  for (const base of ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"]) {
    const check = (source = read(path), readSource = read) => verifyProtectedSource(path, source, gitSource(base, path), readSource);
    it(`${base}: restores the complete original module from only exact reviewed wiring`, () => {
      expect(check().exactBoundaryVerified).toBe(true);
    });
    it.each([
      ["profit aggregation", `SUM(\${moneyCny})`, `SUM(\${betCny})`],
      ["first-insert hook", "if (inserted.length && _ordersInsertedHook)", "if (_ordersInsertedHook)"],
      ["hook payload bypass", "inserted.push(financialOrdersHookRow(clean));", "inserted.push(clean);"],
      ["upsert amount", "bet_money = EXCLUDED.bet_money", "bet_money = 0"],
      ["missing finance relation", `FROM \${financialOrdersRelation("pm")}`, "FROM orders pm"],
      ["ordinary target bypass", "ordinaryOrdersUpsertSql(UPSERT_ORDERS_BATCH_SQL)", "UPSERT_ORDERS_BATCH_SQL"],
      ["deletion bypass", "? minimalFinancialDeletionSql(DELETE_FINANCIAL_ORDERS_SQL) :", "? \"DELETE FROM orders\" :"],
    ])(`${base}: rejects %s changes`, (_, before, after) => {
      const historical = /ordinaryOrdersUpsertSql|minimalFinancialDeletionSql/.test(before);
      const source = historical ? gitSource(retirementBase, path) : read(path);
      const reader = historical ? file => gitSource(retirementBase, file) : read;
      expect(source).toContain(before);
      expect(() => check(source.replace(before, after), reader)).toThrow();
    });
    it(`${base}: rejects extra actions elsewhere in the full module`, () => {
      expect(() => check(`${read(path)}\nvoid performUnexpectedBet();\n`)).toThrow();
    });
    it(`${base}: restoring the whole old module cannot bypass required compatibility wiring`, () => {
      expect(() => check(gitSource(base, path))).toThrow("complete native module after retirement");
    });
  }
  it.each([
    ["finance filter", "public.orders_financial", "public.orders"],
    ["unknown row gate", "AND NOT pending.financial_ready", "AND pending.financial_ready"],
    ["update gate", "WHERE orders.financial_ready", "WHERE true"],
    ["control deletion", "t.execution_id IS NULL", "true"],
    ["lock upgrade", "FOR UPDATE", "FOR SHARE"],
    ["identity conflict", "execution_id=($11::jsonb->>'pmGtcExecutionId')::uuid", "true"],
    ["schema fallback", "if (result.rows?.[0]?.valid !== true)", "if (false)"],
    ["hook payload leak", "!control.has(key)", "true"],
  ])("rejects %s changes inside the full historical helper", (_, before, after) => {
    const reader = file => retiredHelpers.includes(file) ? gitSource(retirementBase, file) : read(file);
    expect(reader(ordersCompatPath)).toContain(before);
    expect(() => verifyOrdersCompatHelper(file => file === ordersCompatPath ? reader(file).replace(before, after) : reader(file))).toThrow("complete reviewed orders compatibility helper");
  });
});

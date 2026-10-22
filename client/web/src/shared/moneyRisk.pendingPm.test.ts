import { expect, it } from "vitest";
import type { OrderRow } from "@/types/order";
import { executeMoneyRisk } from "./moneyRisk";

it("pending PM submissions do not dilute rejection rates or change financial risk tags", () => {
  const rejected = { Type: "Polymarket", Status: "Reject", BetMoney: 100, Money: 0, CreateAt: Date.now() } as OrderRow;
  const input = { MoneyLog: [], Balance: 0, Orders: [rejected] };
  const baseline = executeMoneyRisk(input);
  expect(executeMoneyRisk({ ...input, Orders: [rejected, { ...rejected, Status: "Pending" }] })).toEqual(baseline);
  expect(executeMoneyRisk({ ...input, Orders: [rejected, { ...rejected, Type: "RAY", Status: "Pending" }] }))
    .not.toEqual(baseline);
});

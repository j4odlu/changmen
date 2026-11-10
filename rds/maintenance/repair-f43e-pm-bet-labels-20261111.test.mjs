import { expect, it, vi } from "vitest";
import { ACCOUNT, SINCE, officialBetLabels, planBetLabelRepair, repairBetLabels } from "./repair-f43e-pm-bet-labels-20261111.mjs";

const condition = `0x${"1".repeat(64)}`, until = SINCE + 10000;
const market = { condition_id: condition, question: "Dota 2: A vs B (BO3) - League Group Stage",
  tokens: [{ token_id: "111", outcome: "A" }, { token_id: "222", outcome: "B" }] };
const evidence = [{ source: `https://clob.polymarket.com/markets/${condition}`, market }];
const row = () => ({ id: "1", player_id: String(ACCOUNT), user_id: "owner", provider: "Polymarket",
  order_id: "original-order", create_at: String(SINCE + 1), bet: "[地图3] 获胜", item: "A", match: "A vs B",
  status: "None", bet_money: 25, money: 0, odds: 3.571, link: "original-link",
  raw: { bet: "[地图3] 获胜", Bet: "[地图3] 获胜", pmConditionId: condition, pmTokenId: "111", pmShares: 12.9286,
    pmSubmission: { makerAmount: "3620000" }, clientMarket: { matchId: 17, betId: 22, round: 3, betName: "[地图3] 获胜" } } });

it("uses official token identity, changes only labels, and is idempotent", () => {
  const before = row(), snapshot = structuredClone(before);
  const plan = planBetLabelRepair([before], evidence, until), patch = plan.patches[0];
  expect(patch).toEqual({ id: "1", previousBet: before.bet, bet: "全场", raw: { ...before.raw, bet: "全场", Bet: "全场" } });
  expect(before).toEqual(snapshot);
  expect(planBetLabelRepair([{ ...before, bet: patch.bet, raw: patch.raw }], evidence, until).patches).toEqual([]);
  expect(officialBetLabels([{ ...evidence[0], market: { ...market, question: "Dota 2: A vs B - Game 2 Winner" } }]).get(JSON.stringify([condition, "111"]))).toBe("地图2");
});

it("preserves the changmen map with an explicit source for identity-less rejected submissions", () => {
  const rejected = { ...row(), status: "Reject", order_id: "pm-rej-292-1794268379829-api_failed" };
  delete rejected.raw.pmConditionId; delete rejected.raw.pmTokenId; delete rejected.raw.pmShares;
  const patch = planBetLabelRepair([rejected], evidence, until).patches[0];
  expect(patch.bet).toBe("changmen 盘口：[地图3] 获胜");
  expect(patch.raw.clientMarket).toEqual(rejected.raw.clientMarket);
  expect(planBetLabelRepair([{ ...rejected, bet: patch.bet, raw: patch.raw }], evidence, until).patches).toEqual([]);
});

it.each([
  record => { record.raw.pmTokenId = "333"; },
  record => { record.raw.pmConditionId = `0x${"2".repeat(64)}`; },
  record => { record.player_id = "214"; },
  record => { record.provider = "RAY"; },
  record => { record.create_at = String(SINCE - 1); },
])("rejects mismatched or out-of-scope records", mutate => {
  const record = row(); mutate(record);
  expect(() => planBetLabelRepair([record], evidence, until)).toThrow();
});

it("rejects untrusted evidence URLs and non-winner questions", () => {
  expect(() => officialBetLabels([{ ...evidence[0], source: "https://example.com/market" }])).toThrow();
  expect(() => officialBetLabels([{ ...evidence[0], market: { ...market, question: "Dota 2: A vs B (BO3) - Total Maps" } }])).toThrow();
});

function fixture({ changeMoney = false } = {}) {
  let record = row(); const events = [];
  const client = { query: vi.fn(async (sql, params) => {
    events.push(sql);
    if (sql.includes("FROM players")) return { rows: [{ id: ACCOUNT, owner_user_id: "owner", provider: "Polymarket", player_name: "f43e" }] };
    if (sql.startsWith("SELECT * FROM orders")) return { rows: [structuredClone(record)] };
    if (sql.startsWith("UPDATE orders")) {
      record = { ...record, bet: params[1], raw: JSON.parse(params[2]), ...(changeMoney ? { money: 99 } : {}) };
      return { rowCount: 1 };
    }
    return { rows: [] };
  }) };
  const saveBackup = vi.fn(async () => { events.push("BACKUP"); return "/backup.json"; });
  return { client, events, saveBackup, expectedFingerprint: planBetLabelRepair([record], evidence, until).fingerprint };
}

it("previews in a read-only transaction without writes or locks", async () => {
  const h = fixture();
  expect(await repairBetLabels(h.client, evidence, { until })).toMatchObject({ applied: false, inspected: 1, changed: 1 });
  expect(h.events.some(sql => sql.startsWith("UPDATE") || sql.includes("FOR UPDATE"))).toBe(false);
});

it("backs up before changing labels and verifies every financial field before committing", async () => {
  const h = fixture();
  expect(await repairBetLabels(h.client, evidence, { ...h, until, apply: true })).toMatchObject({ changed: 1, backup: "/backup.json" });
  expect(h.events.indexOf("BACKUP")).toBeLessThan(h.events.findIndex(sql => sql.startsWith("UPDATE")));
  expect(h.events.at(-1)).toBe("COMMIT");
});

it("rolls back if a financial field changes", async () => {
  const h = fixture({ changeMoney: true });
  await expect(repairBetLabels(h.client, evidence, { ...h, until, apply: true })).rejects.toThrow("Non-label order fields changed");
  expect(h.events.at(-1)).toBe("ROLLBACK");
});

it("refuses a stale plan or missing backup before any mutation", async () => {
  for (const overrides of [{ expectedFingerprint: "stale" }, { saveBackup: undefined }]) {
    const h = fixture();
    await expect(repairBetLabels(h.client, evidence, { ...h, ...overrides, until, apply: true })).rejects.toThrow();
    expect(h.events.some(sql => sql.startsWith("UPDATE"))).toBe(false);
  }
});

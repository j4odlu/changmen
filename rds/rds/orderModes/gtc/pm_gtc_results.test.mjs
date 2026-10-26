import { beforeEach, expect, it, vi } from "vitest";
import { savePmGtcConfirmedResult } from "./pm_gtc_results.js";
const mock = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), settled: vi.fn(), rows: [], noDb: false }));
vi.mock("../../common.js", () => ({ getPgPool: () => mock.noDb ? null : { connect: async () => ({ query: mock.query, release: mock.release }) } }));
vi.mock("./pm_gtc_settlement.js", () => ({ syncPmGtcSettledOrderFinancials: mock.settled }));
const hash = `0x${"a".repeat(64)}`;
const fill = { key: "one", tradeId: "one", role: "MAKER", shares: "3", price: "0.5", status: "CONFIRMED" };
const result = () => ({ executionId: "id", orderId: hash, playerId: 1, revision: 4, createdAt: 1, linkId: 10, match: "m", bet: "b", item: "i", tokenId: "t", conditionId: "c", fills: [fill], financial: { pmShares: 3, pmFillPrice: 0.5, pmStakeUsdc: 1.5, pmFeeUsdc: 0, odds: 2, betMoney: 10.05 } });
const previous = (raw = {}) => ({ player_id: 1, provider: "Polymarket", order_id: hash.toUpperCase(), raw: { pmGtcExecutionId: "id", pmGtcBuyShares: 3, pmGtcConfirmedFills: [fill], ...raw } });
const inserted = () => mock.query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO orders"));
it("writes GTC type into the shared order row without creating an execution or a second financial order", async () => {
  await savePmGtcConfirmedResult("owner", result());
  const [sql, params] = inserted();
  expect(sql).toContain("INSERT INTO orders"); expect(params[10]).toMatchObject({ pmOrderType: "GTC", pmGtcExecutionId: "id" });
  expect(mock.query.mock.calls.filter(([statement]) => statement.startsWith("INSERT INTO orders"))).toHaveLength(1);
  expect(mock.query.mock.calls.some(([statement]) => statement.includes("pm_gtc_executions"))).toBe(false);
});
beforeEach(() => { vi.clearAllMocks(); mock.rows = []; mock.noDb = false; mock.settled.mockResolvedValue([]);
  mock.query.mockImplementation(async sql => ({ rows: sql.startsWith("SELECT player_id") ? mock.rows : [] })); });
it("writes confirmed results only to orders, with atomic settlement correction", async () => {
  await savePmGtcConfirmedResult("owner", result());
  expect(mock.query.mock.calls.every(([sql]) => !sql.includes("pm_gtc_executions"))).toBe(true);
  expect(inserted()[1][10]).toMatchObject({ pmGtcExecutionId: "id", pmGtcResultRevision: 4, pmGtcConfirmedFills: [fill] });
  expect(inserted()[1][10]).not.toHaveProperty("cancel");
  expect(mock.settled).toHaveBeenCalledWith(expect.anything(), "owner", 1, hash, "id");
  expect(mock.query.mock.calls.at(-1)[0]).toBe("COMMIT");
});
it.each([4, 8])("ignores equal or newer saved result version %s", async revision => {
  mock.rows = [previous({ pmGtcResultRevision: revision })]; await savePmGtcConfirmedResult("owner", result());
  expect(inserted()).toBeUndefined(); expect(mock.settled).not.toHaveBeenCalled(); expect(mock.query.mock.calls.at(-1)[0]).toBe("COMMIT");
});
it("does not duplicate differently cased order hashes or erase sell cash and manual Link", async () => {
  mock.rows = [previous({ pmSellProceeds: 1, pmRealizedPnlUsdc: 0.2 })];
  const next = result(); next.financial.pmShares = 5; next.financial.pmStakeUsdc = 2.5;
  next.fills.push({ ...fill, key: "two", tradeId: "two", shares: "2" }); await savePmGtcConfirmedResult("owner", next);
  const [sql, params] = inserted(); expect(params[2]).toBe(hash.toUpperCase());
  expect(sql).toContain("ELSE orders.link"); expect(sql).toContain("pmSellProceeds"); expect(sql).toContain("pmRealizedPnlUsdc");
  expect(sql).toContain("'pmGtcOrderSnapshot','pmGtcRevision'");
});
it("refuses unexplained quantity decreases and rolls back", async () => {
  mock.rows = [previous()]; const next = result(); next.financial.pmShares = 1;
  await expect(savePmGtcConfirmedResult("owner", next)).rejects.toThrow("FAILED 证据");
  expect(inserted()).toBeUndefined(); expect(mock.query.mock.calls.at(-1)[0]).toBe("ROLLBACK"); expect(mock.release).toHaveBeenCalledOnce();
});
it("accepts only matching immutable FAILED evidence for quantity rollback", async () => {
  mock.rows = [previous()]; const next = result(); next.financial.pmShares = 0; next.fills = [{ ...fill, status: "FAILED" }];
  await savePmGtcConfirmedResult("owner", next); expect(inserted()).toBeDefined();
  next.revision++; next.fills[0].shares = "4";
  await expect(savePmGtcConfirmedResult("owner", next)).rejects.toThrow("身份冲突");
});
it("never resurrects a FAILED fill or reassigns an execution to another account", async () => {
  mock.rows = [previous({ pmGtcConfirmedFills: [{ ...fill, status: "FAILED" }] })];
  await expect(savePmGtcConfirmedResult("owner", result())).rejects.toThrow("FAILED 回退");
  mock.rows = [{ ...previous(), player_id: 2 }];
  await expect(savePmGtcConfirmedResult("owner", result())).rejects.toThrow("其他账号");
});
it("no zero intent row is created and unavailable RDS never acknowledges a result", async () => {
  const zero = result(); zero.financial.pmShares = 0;
  await savePmGtcConfirmedResult("owner", zero); expect(inserted()).toBeUndefined();
  mock.noDb = true; await expect(savePmGtcConfirmedResult("owner", result())).rejects.toThrow("RDS");
});

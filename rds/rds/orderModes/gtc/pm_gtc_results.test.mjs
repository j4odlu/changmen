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
it("persists optional market identity and retains it on later confirmed results", async () => {
  const clientMarket = { matchId: 17, betId: 22, round: 3, game: "CS2", matchTitle: "A vs B", betName: "地图3" };
  await savePmGtcConfirmedResult("owner", { ...result(), clientMarket });
  expect(inserted()[1][10].clientMarket).toEqual(clientMarket);
  mock.query.mockClear(); mock.rows = [previous({ clientMarket })];
  await savePmGtcConfirmedResult("owner", result());
  expect(inserted()[1][10].clientMarket).toEqual(clientMarket);
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
const accepted = (patch = {}) => ({ shares: "10", price: "0.5", ...patch });
it("creates an accepted zero-fill order with no invented cost or fill price", async () => {
  await savePmGtcConfirmedResult("owner", { ...result(), acceptedOrder: accepted(), fills: [],
    financial: { pmShares: 0, pmFillPrice: 0, pmStakeUsdc: 0, pmFeeUsdc: 0, odds: 0, betMoney: 0 } });
  expect(inserted()[1][10]).toMatchObject({ pmGtcAcceptedOrder: accepted(), pmGtcBuyShares: 0, pmGtcBuyCost: 0,
    pmShares: 0, pmStakeUsdc: 0, pmFillPrice: 0 });
  expect(inserted()[0]).toContain("ELSE orders.link END");
});
it("writes ordinary Return for zero-fill cancellation and keeps partial fills as None", async () => {
  await savePmGtcConfirmedResult("owner", { ...result(), status: "Return", acceptedOrder: accepted(), fills: [],
    financial: { pmShares: 0, pmFillPrice: 0, pmStakeUsdc: 0, pmFeeUsdc: 0, odds: 0, betMoney: 0 } });
  expect(inserted()[1][13]).toBe("Return");
  expect(inserted()[0]).toContain("WHEN orders.status IN ('None','Return') THEN EXCLUDED.status ELSE orders.status END");
  mock.query.mockClear(); await savePmGtcConfirmedResult("owner", { ...result(), status: "None" });
  expect(inserted()[1][13]).toBe("None");
});
it("backfills Return for an already reconciled zero-fill original at the same revision", async () => {
  mock.rows = [{ ...previous({ pmGtcResultRevision: 4, pmGtcBuyShares: 0, pmGtcConfirmedFills: [], pmGtcAcceptedOrder: accepted() }), status: "None" }];
  const zero = { ...result(), status: "Return", acceptedOrder: accepted(), fills: [],
    financial: { pmShares: 0, pmFillPrice: 0, pmStakeUsdc: 0, pmFeeUsdc: 0, odds: 0, betMoney: 0 } };
  await savePmGtcConfirmedResult("owner", zero);
  expect(inserted()[1][13]).toBe("Return");
  mock.query.mockClear(); mock.rows[0].status = "Return";
  await savePmGtcConfirmedResult("owner", zero); expect(inserted()).toBeUndefined();
});
it("clears Return while late fills are pending even though confirmed financial shares remain zero", async () => {
  mock.rows = [{ ...previous({ pmGtcResultRevision: 3, pmGtcBuyShares: 0, pmGtcConfirmedFills: [], pmGtcAcceptedOrder: accepted() }), status: "Return" }];
  await savePmGtcConfirmedResult("owner", { ...result(), status: "None", acceptedOrder: accepted(), fills: [],
    financial: { pmShares: 0, pmFillPrice: 0, pmStakeUsdc: 0, pmFeeUsdc: 0, odds: 0, betMoney: 0 } });
  expect(inserted()[1][13]).toBe("None");
  expect(inserted()[0]).toContain("ELSE orders.status END");
});
it("retains one original and manual Link when its first fill arrives after zero-fill acceptance", async () => {
  mock.rows = [previous({ pmGtcBuyShares: 0, pmGtcConfirmedFills: [], pmGtcAcceptedOrder: accepted(), pmGtcResultRevision: 2 })];
  await savePmGtcConfirmedResult("owner", { ...result(), acceptedOrder: accepted() });
  expect(inserted()[1][2]).toBe(hash.toUpperCase());
  expect(inserted()[1][10].pmGtcBuyShares).toBe(3);
  expect(inserted()[0]).toContain("ELSE orders.link END");
});
it("enriches a saved result at the same revision and retains acceptance for legacy updates", async () => {
  mock.rows = [previous({ pmGtcResultRevision: 4 })];
  await savePmGtcConfirmedResult("owner", { ...result(), acceptedOrder: accepted() });
  expect(inserted()[1][10].pmGtcAcceptedOrder).toEqual(accepted());
  mock.query.mockClear();
  const original = accepted();
  mock.rows = [previous({ pmGtcAcceptedOrder: original })];
  await savePmGtcConfirmedResult("owner", result());
  expect(inserted()[1][10].pmGtcAcceptedOrder).toEqual(original);
});
it("rejects changed original parameters and omitted confirmed fills", async () => {
  mock.rows = [previous({ pmGtcAcceptedOrder: accepted() })];
  await expect(savePmGtcConfirmedResult("owner", { ...result(), acceptedOrder: accepted({ price: "0.4" }) })).rejects.toThrow("不可变更");
  await expect(savePmGtcConfirmedResult("owner", { ...result(), fills: [] })).rejects.toThrow("不可遗漏");
});

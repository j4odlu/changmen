import { beforeEach, describe, expect, it, vi } from "vitest";
import { upsertPmGtcOrders } from "./pm_gtc_orders_store.js";

const mock = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), connect: vi.fn(), ready: true }));
vi.mock("../../common.js", () => ({ getPgPool: () => mock.ready ? { connect: mock.connect } : null, _jsonb: (value, fallback) => JSON.stringify(value ?? fallback) }));
const record = { orderId: "buy", plan: { playerId: 1, orderHash: "hash", otherPlayerId: 2, otherProvider: "RAY" }, other: { state: "accepted", orderId: "ray" } };
const row = (patch = {}) => ({ user_id: "owner", player_id: 1, order_id: "buy", provider: "Polymarket", create_at: 1, raw: { pmGtcExecutionId: "g", pmSide: "buy" }, ...patch });
beforeEach(() => { vi.clearAllMocks(); mock.ready = true; mock.connect.mockResolvedValue({ query: mock.query, release: mock.release }); mock.query.mockImplementation(async sql => ({ rows: sql.includes("SELECT record") ? [{ record }] : [] })); });
describe("dedicated GTC persistence", () => {
  it("checks durable owner/original identity under a record lock before writing", async () => {
    expect(await upsertPmGtcOrders([row()])).toBe(true);
    expect(mock.query.mock.calls[1]).toEqual(["SELECT record FROM pm_gtc_executions WHERE id=$1 AND owner=$2 FOR SHARE", ["g", "owner"]]);
    expect(mock.query.mock.calls.at(-1)[0]).toBe("COMMIT"); expect(mock.release).toHaveBeenCalledOnce();
  });
  it("wrong original player rolls back without financial writes", async () => {
    expect(await upsertPmGtcOrders([row({ player_id: 99 })])).toBe(false);
    expect(mock.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO orders"))).toBe(false);
    expect(mock.query.mock.calls.at(-1)[0]).toBe("ROLLBACK");
  });
  it("zero fill snapshots require an existing authoritative financial order", async () => {
    await upsertPmGtcOrders([row()]);
    const sql = mock.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO orders"))[0];
    expect(sql).toContain("canonical.raw->>'pmGtcExecutionId'=t.raw->>'pmGtcExecutionId'");
    expect(sql).toContain("pmFeeUsdc"); expect(sql).toContain("pmGtcBuyShares");
  });
  it("keeps original buy amount and gross fill shares when ordinary selling saves a position update", async () => {
    await upsertPmGtcOrders([row({ bet_money: 49.08353, raw: { pmGtcExecutionId: "g", pmSide: "buy", pmAttributedSellShares: 3, pmSellProceeds: 2.4, pmRealizedPnlUsdc: 0.03 } })]);
    const sql = mock.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO orders"))[0];
    expect(sql).toContain("THEN orders.bet_money ELSE EXCLUDED.bet_money END");
    expect(sql).toContain("'pmShares', (orders.raw->>'pmGtcBuyShares')::float8");
    expect(sql).not.toContain("orders.bet_money / NULLIF");
  });
  it("empty/unavailable storage does not fall back to FOK", async () => {
    expect(await upsertPmGtcOrders([])).toBe(false); mock.ready = false;
    expect(await upsertPmGtcOrders([row()])).toBe(false); expect(mock.connect).not.toHaveBeenCalled();
  });
});

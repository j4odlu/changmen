import { createGtcExecution } from "@changmen/shared/pm_gtc";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPmGtc, listPmGtc, mutatePmGtc } from "./pm_gtc_store.js";

const mocks = vi.hoisted(() => ({ pool: vi.fn(), query: vi.fn(), connection: vi.fn(), release: vi.fn(), noDb: false }));
vi.mock("../../common.js", () => ({ getPgPool: () => mocks.noDb ? null : { query: mocks.pool, connect: mocks.connection } }));
const plan = { shares: "10", orderHash: "hash", originalPmLeg: "A" };
const created = () => createGtcExecution("id", "owner", "wallet", "maker", plan, 1);
beforeEach(() => { vi.clearAllMocks(); mocks.noDb = false; mocks.pool.mockResolvedValue({ rows: [] }); mocks.query.mockResolvedValue({ rows: [] }); mocks.connection.mockResolvedValue({ query: mocks.query, release: mocks.release }); });
describe("gTC persistence fails before venue dispatch without durable coordination", () => {
  it("GTC recovery repairs only mode metadata using owned original order identities", async () => {
    mocks.pool.mockImplementation(async sql => ({ rows: sql.startsWith("SELECT record") ? [{ record: created() }] : [] }));
    expect(await listPmGtc("owner")).toEqual([created()]);
    const [sql, params] = mocks.pool.mock.calls.find(([query]) => query.startsWith("UPDATE orders"));
    expect(params).toEqual(["owner"]);
    expect(sql).toContain("e.owner=$1 AND o.user_id=$1");
    expect(sql).toContain("o.player_id=anchor.player_id AND o.provider=anchor.provider");
    expect(sql).toContain("pmBuyOrderId"); expect(sql).toContain("pfBuyOrderId");
    expect(sql).toContain("LOWER(anchor.order_id)");
    expect(sql).not.toMatch(/SET\s+(bet_money|money|link)/);
    expect(sql).not.toContain("pmGtcBuyCost");
  });
  it("stores ordinary PM price odds while recording the fee-inclusive buy amount", async () => {
    const row = created();
    row.plan = { ...row.plan, playerId: 1, fx: 6.7, shares: "9.29", linkId: -1000, source: "manual" };
    row.pmAuthorized = true; row.orderId = "hash"; row.submit = "accepted"; row.decision = "closed";
    mocks.query.mockImplementation(async sql => ({ rows: sql.includes("SELECT wallet_key") ? [{ wallet_key: "wallet" }] : sql.includes("SELECT record") ? [{ record: row }] : [] }));
    await mutatePmGtc("owner", "id", row.revision, { kind: "facts", facts: {
      order: { id: "hash", original: "9.29", matched: "9.29", status: "MATCHED", tradeIds: ["trade"], source: "confirmed-trades" },
      fills: [{ key: "trade:taker", tradeId: "trade", bucket: "taker", role: "TAKER", shares: "9.29", price: "0.78", fee: "0.07971", status: "CONFIRMED", updatedAt: 3 }],
      complete: true,
      observedAt: 3,
    }, financialOrder: { pmShares: 9.29, pmFillPrice: 0.78, pmStakeUsdc: 7.3259, pmFeeUsdc: 0.0797, odds: 1.2821, betMoney: 7.3259 * 6.7 } });
    const insertion = mocks.query.mock.calls.find(([sql]) => sql.startsWith("INSERT INTO orders"));
    expect(insertion[1][7]).toBe(1.2821);
    expect(insertion[1][8]).toBe(7.3259 * 6.7);
    expect(insertion[1][10]).toMatchObject({ pmShares: 9.29, pmStakeUsdc: 7.3259, pmFeeUsdc: 0.0797, pmGtcExecutionId: "id" });
  });
  it("unavailable DB does not yield local authorization", async () => { mocks.noDb = true; await expect(listPmGtc("owner")).rejects.toThrow("RDS"); expect(mocks.connection).not.toHaveBeenCalled(); });
  it("reserves wallet in advisory-locked transaction", async () => {
    await createPmGtc({ id: "id", owner: "owner", walletKey: "wallet", maker: "maker", plan });
    const calls = mocks.query.mock.calls; expect(calls[0][0]).toBe("BEGIN"); expect(calls[1][0]).toContain("pg_advisory_xact_lock");
    expect(calls.find(([sql]) => sql.startsWith("INSERT INTO pm_gtc_executions"))[1][3].pmAuthorized).toBe(false); expect(calls.at(-1)[0]).toBe("COMMIT");
  });
  it("another active wallet execution rolls back rather than dispatching", async () => {
    mocks.query.mockImplementation(async sql => ({ rows: sql.includes("SELECT id FROM pm_gtc_executions") ? [{ id: "active" }] : [] }));
    await expect(createPmGtc({ id: "id", owner: "owner", walletKey: "wallet", maker: "maker", plan })).rejects.toThrow("未完结");
    expect(mocks.query.mock.calls.at(-1)[0]).toBe("ROLLBACK"); expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
  });
  it("new manual execution commits despite an existing active wallet execution", async () => {
    mocks.query.mockImplementation(async sql => ({ rows: sql.includes("SELECT id FROM pm_gtc_executions") ? [{ id: "active" }] : [] }));
    const row = await createPmGtc({ id: "manual", owner: "owner", walletKey: "wallet", maker: "maker", plan: { ...plan, source: "manual" } });
    expect(row).toMatchObject({ id: "manual", plan: { source: "manual" }, pmAuthorized: false });
    expect(mocks.query.mock.calls.at(-1)[0]).toBe("COMMIT");
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("SELECT id FROM pm_gtc_executions"))).toBe(false);
  });
  it("multiple manual orders remain separate and each can only be authorized once", async () => {
    const records = new Map();
    mocks.query.mockImplementation(async (sql, params = []) => {
      const row = records.get(params[0]);
      if (sql.startsWith("INSERT INTO pm_gtc_executions"))
        records.set(params[0], params[3]);
      if (sql.startsWith("UPDATE pm_gtc_executions"))
        records.set(params[0], params[2]);
      if (sql.startsWith("SELECT wallet_key"))
        return { rows: row && row.owner === params[1] ? [{ wallet_key: row.walletKey }] : [] };
      if (sql.startsWith("SELECT record"))
        return { rows: row && (params.length === 1 || row.owner === params[1]) ? [{ record: row }] : [] };
      if (sql.includes("SELECT id FROM pm_gtc_executions"))
        return { rows: [...records.values()].filter(r => !r.released).map(r => ({ id: r.id })) };
      return { rows: [] };
    });
    for (const id of ["first", "second"]) {
      const manualPlan = { ...plan, source: "manual", orderHash: id };
      await createPmGtc({ id, owner: "owner", walletKey: "wallet", maker: "maker", plan: manualPlan });
      await mutatePmGtc("owner", id, 0, { kind: "authorize_pm" });
      await mutatePmGtc("owner", id, 1, { kind: "ack", state: "accepted", orderId: id });
      await expect(mutatePmGtc("owner", id, 2, { kind: "authorize_pm" })).rejects.toThrow("禁止重发");
    }
    expect(records.size).toBe(2);
    expect(records.get("first")).toMatchObject({ orderId: "first", pmAuthorized: true, released: false });
    expect(records.get("second")).toMatchObject({ orderId: "second", pmAuthorized: true, released: false });
    await mutatePmGtc("owner", "first", 2, { kind: "close" });
    expect(records.get("first").decision).toBe("closed");
    expect(records.get("second").decision).toBe("open");
  });
  it("retrying creation with the same manual execution ID returns the original record", async () => {
    const manualPlan = { ...plan, source: "manual" };
    const existing = createGtcExecution("manual", "owner", "wallet", "maker", manualPlan, 1);
    mocks.query.mockImplementation(async sql => ({ rows: sql.startsWith("SELECT record") ? [{ record: existing }] : [] }));
    expect(await createPmGtc({ id: "manual", owner: "owner", walletKey: "wallet", maker: "maker", plan: manualPlan })).toEqual(existing);
    expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
  });
  it("manual source cannot overwrite another execution identity", async () => {
    mocks.query.mockImplementation(async sql => ({ rows: sql.startsWith("SELECT record") ? [{ record: created() }] : [] }));
    await expect(createPmGtc({ id: "id", owner: "owner", walletKey: "wallet", maker: "maker", plan: { ...plan, source: "manual" } })).rejects.toThrow("身份冲突");
    expect(mocks.query.mock.calls.at(-1)[0]).toBe("ROLLBACK");
  });
  it("row revision race cannot grant second authorization", async () => {
    mocks.query.mockImplementation(async sql => ({ rows: sql.includes("SELECT wallet_key") ? [{ wallet_key: "wallet" }] : sql.includes("SELECT record") ? [{ record: created() }] : [] }));
    await expect(mutatePmGtc("owner", "id", 9, { kind: "authorize_pm" })).rejects.toThrow("记录已更新");
    expect(mocks.query.mock.calls.at(-1)[0]).toBe("ROLLBACK"); expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
  });
  it("authorizes once under row lock and commits before caller can POST", async () => {
    mocks.query.mockImplementation(async sql => ({ rows: sql.includes("SELECT wallet_key") ? [{ wallet_key: "wallet" }] : sql.includes("SELECT record") ? [{ record: created() }] : [] }));
    const row = await mutatePmGtc("owner", "id", 0, { kind: "authorize_pm" }); expect(row.pmAuthorized).toBe(true); expect(row.revision).toBe(1);
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes("FOR UPDATE"))).toBe(true); expect(mocks.query.mock.calls.at(-1)[0]).toBe("COMMIT");
    expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO orders"))).toBe(false);
  });
  it("closing legacy unsubmitted PM after other-leg rejection clears active reservation without a financial order", async () => {
    const legacy = created(); legacy.submit = "rejected"; legacy.decision = "closed"; legacy.manual = true;
    legacy.other = { state: "rejected", orderId: null, submittedAt: 2, message: "赔率下降至1.84" };
    mocks.query.mockImplementation(async sql => ({ rows: sql.includes("SELECT wallet_key") ? [{ wallet_key: "wallet" }] : sql.includes("SELECT record") ? [{ record: legacy }] : [] }));
    const row = await mutatePmGtc("owner", "id", 0, { kind: "close" });
    expect(row).toMatchObject({ submit: "not_attempted", released: true, pmAuthorized: false, orderId: null });
    const update = mocks.query.mock.calls.find(([sql]) => sql.startsWith("UPDATE pm_gtc_executions"));
    expect(update[1][3]).toBe(false); expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO orders"))).toBe(false);
  });
  it("foreign owner cannot mutate even with a known execution ID", async () => {
    await expect(mutatePmGtc("foreign", "id", 0, { kind: "authorize_pm" })).rejects.toThrow("无权"); expect(mocks.release).toHaveBeenCalledOnce();
  });
});

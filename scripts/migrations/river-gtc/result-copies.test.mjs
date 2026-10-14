import { expect, it } from "vitest";
import { planResultCopies, applyResultCopyBatch } from "./result-copies.mjs";
const owner = "11111111-1111-1111-1111-111111111111", executionId = "22222222-2222-2222-2222-222222222222";
function fixture(complete = true) {
  const source = { id: executionId, owner, updated_at: "3", record: { id: executionId, owner, revision: 1, plan: { playerId: 1, otherPlayerId: 2, otherProvider: "RAY", originalPmLeg: "A", shares: "10" }, orderId: "BUY", submit: "accepted", complete, matched: complete ? "10" : "0", open: complete ? "0" : "10", order: { status: complete ? "MATCHED" : "LIVE" } } };
  const order = { id: "7", user_id: owner, player_id: "1", provider: "Polymarket", order_id: "buy", status: "Win", bet_money: 33.5, money: 50, raw: { pmGtcExecutionId: executionId, pmSide: "buy", pmShares: 10 } };
  return { source, order, plan: planResultCopies(owner, [source], [order]) };
}
it("preserves unresolved official evidence rather than inventing a terminal state", () => {
  const f = fixture(false); expect(f.plan.operations[0].snapshot).toMatchObject({ officialStatus: "LIVE", factsComplete: false });
  expect(f.order.status).toBe("Win"); expect(f.source.record.complete).toBe(false);
});
it.each(["foreign-owner", "FOK", "wrong-player", "wrong-order", "unknown-execution"])("rejects an unrelated row %s", change => {
  const { source, order } = fixture();
  if (change === "foreign-owner") order.user_id = "foreign";
  if (change === "FOK") delete order.raw.pmGtcExecutionId;
  if (change === "wrong-player") order.player_id = "3";
  if (change === "wrong-order") order.order_id = "different";
  if (change === "unknown-execution") order.raw.pmGtcExecutionId = "different";
  expect(() => planResultCopies(owner, [source], [order])).toThrow();
});
it("does not copy buy snapshots to sell or counterpart orders", () => {
  const { source, order } = fixture();
  expect(planResultCopies(owner, [source], [{ ...order, provider: "RAY" }, { ...order, raw: { ...order.raw, pmSide: "sell" } }]).operations).toEqual([]);
});
it("a matching copy is idempotent while a contradictory one stops", () => {
  const f = fixture(); f.order.raw.pmGtcOrderSnapshot = f.plan.operations[0].snapshot;
  expect(planResultCopies(owner, [f.source], [f.order]).operations).toEqual([]);
  f.order.raw.pmGtcOrderSnapshot.factsComplete = false;
  expect(() => planResultCopies(owner, [f.source], [f.order])).toThrow("existing result copy");
});
it.each(["success", "source-change", "writer-error", "financial-change", "backup-error"])("keeps full financial/source boundaries and rollback behavior: %s", async scenario => {
  const f = fixture(), calls = [];
  const client = { query: async (sql, params) => {
    calls.push(sql);
    if (sql.startsWith("SELECT * FROM public.pm_gtc")) return { rows: [{ ...f.source, ...(scenario === "source-change" ? { updated_at: "4" } : {}) }] };
    if (sql.startsWith("SELECT * FROM public.orders")) return { rows: [f.order] };
    if (sql.startsWith("UPDATE")) {
      if (scenario === "writer-error") throw Error("writer unavailable");
      return { rows: [{ ...f.order, ...(scenario === "financial-change" ? { money: 0 } : {}), raw: { ...f.order.raw, pmGtcOrderSnapshot: params[3] } }] };
    }
    return { rows: [] };
  } };
  const task = applyResultCopyBatch(client, f.plan, async () => { if (scenario === "backup-error") throw Error("backup unavailable"); calls.push("BACKUP"); });
  if (scenario === "success") { await task; expect(calls.slice(-2)).toEqual(["BACKUP", "COMMIT"]); }
  else { await expect(task).rejects.toThrow(); expect(calls.at(-1)).toBe("ROLLBACK"); expect(calls).not.toContain("COMMIT"); }
  expect(calls.some(sql => sql.startsWith("UPDATE public.pm_gtc"))).toBe(false);
  expect(f.order).toMatchObject({ money: 50, bet_money: 33.5, status: "Win" });
});

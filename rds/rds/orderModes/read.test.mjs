import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOrderExecutionIdentities, fetchOrdersByExecutionPage } from "./read.js";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../common.js", () => ({ getPgPool: () => ({ query: mocks.query }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.query.mockResolvedValue({ rows: [] }); });
describe("identity routing at the database transport boundary", () => {
  it.each(["FOK", "GTC"])("%s filters metadata, scoped anchors and parent identity before LIMIT", async (mode) => {
    const anchors = [{ player_id: 1, provider: "Polymarket", order_id: "hash" }];
    await fetchOrdersByExecutionPage("2026-10-10", "owner", mode, anchors, 2, 20);
    const [sql, params] = mocks.query.mock.calls[1];
    expect(sql).toContain("identity.player_id=orders.player_id AND identity.provider=orders.provider");
    expect(sql).toContain("parent.user_id=orders.user_id"); expect(sql).toContain("LIMIT $6 OFFSET $7");
    expect(params.slice(3)).toEqual([mode === "GTC", JSON.stringify(anchors), 20, 20]);
  });
  it("reading routing metadata does not initialize the GTC schema", async () => {
    mocks.query.mockResolvedValue({ rows: [{ record: { id: "execution" } }] });
    expect(await fetchOrderExecutionIdentities("owner")).toEqual([{ id: "execution" }]);
    expect(mocks.query).toHaveBeenCalledExactlyOnceWith("SELECT record FROM pm_gtc_executions WHERE owner=$1", ["owner"]);
  });
  it("a missing GTC table does not change FOK availability", async () => {
    mocks.query.mockRejectedValue(new Error("relation does not exist"));
    expect(await fetchOrderExecutionIdentities("owner")).toEqual([]);
  });
  it("strict routing distinguishes a genuinely absent table from an unavailable coordinator", async () => {
    mocks.query.mockRejectedValueOnce(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    expect(await fetchOrderExecutionIdentities("owner", { strict: true })).toEqual([]);
    mocks.query.mockRejectedValueOnce(Object.assign(new Error("connection timeout"), { code: "08006" }));
    await expect(fetchOrderExecutionIdentities("owner", { strict: true })).rejects.toThrow("connection timeout");
  });
});

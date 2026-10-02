import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  batchSavePlayerAccountRecords,
  batchUpdatePlayerDisplayNames,
  fetchBettingUserLogsInRange,
  fetchPlayersByIds,
  saveAccountRecordsForOwner,
} from "./player_store.js";

const queryMock = vi.fn();

vi.mock("./common.js", () => ({
  getPgPool: () => ({ query: queryMock }),
  _jsonb: (val, fallback) => JSON.stringify(val ?? fallback ?? null),
}));

describe("player_store batch SQL", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rows: [], rowCount: 2 });
  });

  it("fetchPlayersByIds uses ANY($1::bigint[])", async () => {
    await fetchPlayersByIds([7, 8]);
    expect(queryMock).toHaveBeenCalledOnce();
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/id = ANY\(\$1::bigint\[\]\)/);
    expect(params).toEqual([[7, 8]]);
  });

  it("prioritizes exact identities across time windows before limiting diagnostic logs", async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 2, create_at: 5000 }, { id: 1, create_at: 1000 }, { id: 3, create_at: 2000 }] });
    const result = await fetchBettingUserLogsInRange("user-1", 1000, 2000, 2, { link: 123, orderIds: ["a.b"] });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("OR ($5::text IS NOT NULL AND data ~ $5)");
    expect(sql).toContain("ORDER BY CASE WHEN");
    expect(params.slice(0, 4)).toEqual(["user-1", 1000, 2000, 3]);
    expect(params[4]).toContain("a\\.b");
    expect(result.rows.map(row => row.id)).toEqual([1, 2]);
    expect(result.truncated).toBe(true);
  });

  it("reports diagnostic database failures instead of returning empty evidence", async () => {
    queryMock.mockRejectedValue(new Error("offline"));
    await expect(fetchBettingUserLogsInRange("user-1", 1000, 2000)).rejects.toThrow("诊断日志查询失败");
  });

  it("batchUpdatePlayerDisplayNames uses unnest", async () => {
    await batchUpdatePlayerDisplayNames("user-1", [
      { playerId: 7, platformName: "A" },
      { playerId: 8, platformName: "B" },
    ]);
    expect(queryMock).toHaveBeenCalledOnce();
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/unnest\(\$1::bigint\[\], \$2::text\[\]\)/);
    expect(params[0]).toEqual([7, 8]);
    expect(params[1]).toEqual(["A", "B"]);
    expect(params[3]).toBe("user-1");
  });

  it("batchSavePlayerAccountRecords uses unnest jsonb[]", async () => {
    await batchSavePlayerAccountRecords("user-1", [
      {
        accountId: 7,
        platformName: "OB-1",
        playerName: "u1",
        provider: "OB",
        venueMemberId: "610738",
        credit: 0,
        balance: 100,
        token: "x",
      },
    ]);
    expect(queryMock).toHaveBeenCalledTimes(2);
    const [sql, params] = queryMock.mock.calls[1];
    expect(sql).toMatch(/\$9::jsonb\[\]/);
    expect(sql).toMatch(/venue_account_key/);
    // PF 守卫只认库内 p.provider（禁止 OR u.provider，避免伪造清 OB credit）
    expect(sql).toMatch(/lower\(p\.provider\) = 'predictfun'/);
    expect(sql).toMatch(/ELSE p\.total_balance/);
    expect(sql).not.toMatch(/OR lower\(u\.provider\) = 'predictfun'/);
    expect(sql).not.toMatch(/coalesce\(u\.provider,\s*p\.provider\)/);
    expect(params[0]).toEqual([7]);
    expect(params[11]).toBe("user-1");
    expect(params[8][0]).toMatchObject({ token: "x" });
  });

  it("saveAccountRecordsForOwner delegates to batch save", async () => {
    await saveAccountRecordsForOwner("user-1", [{ accountId: 7, provider: "OB", balance: 1 }]);
    expect(queryMock.mock.calls.some(([sql]) => /unnest\(/.test(sql))).toBe(true);
  });
});

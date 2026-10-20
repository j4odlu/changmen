import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchOrdersByDate,
  fetchOrdersByPlayer,
  fetchOrdersByPlayerAll,
  fetchOrdersByPlayerOrderIds,
  rebindOrderLink,
  setOrdersBoundHook,
  updateOrderBind,
  upsertOrders,
} from "./orders_store.js";

const queryMock = vi.fn();
const clientQueryMock = vi.fn();
const connectMock = vi.fn(async () => ({
  query: clientQueryMock,
  release: vi.fn(),
}));

vi.mock("./common.js", () => ({
  getPgPool: () => ({ query: queryMock, connect: connectMock }),
  _jsonb: (val, fallback) => JSON.stringify(val ?? fallback ?? null),
}));

describe("orders_store read SQL", () => {
  beforeEach(() => {
    queryMock.mockReset();
    setOrdersBoundHook(null);
  });

  it("fetchOrdersByDate returns all orders (no filter)", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await fetchOrdersByDate("2026-06-18", "user-1");
    expect(queryMock).toHaveBeenCalledOnce();
    const [sql] = queryMock.mock.calls[0];
    expect(sql).not.toMatch(/link\s*<\s*create_at/i);
    expect(sql).not.toMatch(/changmen_bet/i);
    expect(sql).toMatch(/ABS\(link\) >= 1000000000000/);
  });

  it("fetchOrdersByPlayer returns all orders (no filter)", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await fetchOrdersByPlayer(7, "user-1");
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).not.toMatch(/link\s*<\s*create_at/i);
    expect(sql).not.toMatch(/changmen_bet/i);
    expect(sql).not.toMatch(/create_at\s*>=\s*\$3/);
    expect(params).toEqual(["user-1", 7]);
  });

  it("P0-4 D5: fetchOrdersByPlayerStrict throws on query failure", async () => {
    const { fetchOrdersByPlayerStrict } = await import("./orders_store.js");
    queryMock.mockRejectedValueOnce(new Error("rds down"));
    await expect(fetchOrdersByPlayerStrict(7, "user-1")).rejects.toThrow("rds down");
  });

  it("P0-4 D5: fetchOrdersByPlayer still returns [] on failure (lenient)", async () => {
    queryMock.mockRejectedValueOnce(new Error("rds down"));
    await expect(fetchOrdersByPlayer(7, "user-1")).resolves.toEqual([]);
  });

  it("fetchOrdersByPlayer with sinceCreateAt keeps window + open Polymarket buys", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await fetchOrdersByPlayer(7, "user-1", { sinceCreateAt: 1_700_000_000_000 });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/create_at\s*>=\s*\$3/);
    expect(sql).not.toMatch(/status = 'None'/);
    expect(sql).toMatch(/provider ILIKE 'Polymarket'/);
    expect(sql).toMatch(/pmSellState/);
    expect(sql).toMatch(/pmAttributedSellShares/);
    expect(sql).toMatch(/> 0\.01/);
    expect(params).toEqual(["user-1", 7, 1_700_000_000_000]);
  });

  it("fetchOrdersByPlayer ignores invalid sinceCreateAt and loads full", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await fetchOrdersByPlayer(7, "user-1", { sinceCreateAt: 0 });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).not.toMatch(/create_at\s*>=\s*\$3/);
    expect(params).toEqual(["user-1", 7]);
  });

  it("fetchOrdersAdminPage returns all orders (no filter)", async () => {
    queryMock.mockResolvedValue({ rows: [{ n: 0 }] });
    await import("./orders_store.js").then(m =>
      m.fetchOrdersAdminPage({
        dateKey: "2026-06-18",
        pageIndex: 1,
        pageSize: 20,
      }),
    );
    const [sql] = queryMock.mock.calls[0];
    expect(sql).not.toMatch(/link\s*<\s*create_at/i);
    expect(sql).not.toMatch(/changmen_bet/i);
  });

  it("fetchUnifiedFootballOrdersAdmin reads only non-OB sports football orders", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await import("./orders_store.js").then(m =>
      m.fetchUnifiedFootballOrdersAdmin({
        dateKey: "2026-09-21",
        userId: "550e8400-e29b-41d4-a716-446655440000",
        limit: 50,
      }),
    );
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/raw->>'domain'/);
    expect(sql).toMatch(/raw->>'sport'/);
    expect(sql).toMatch(/raw->>'game'/);
    expect(sql).toMatch(/<> 'OB'/);
    expect(params).toEqual([
      expect.any(Number),
      expect.any(Number),
      "550e8400-e29b-41d4-a716-446655440000",
      50,
    ]);
  });

  it("fetchOrdersByPlayerAll returns all orders (saveOrder internal)", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await fetchOrdersByPlayerAll(7, "user-1");
    const [sql] = queryMock.mock.calls[0];
    expect(sql).not.toMatch(/link\s*<\s*create_at/i);
    expect(sql).not.toMatch(/changmen_bet/i);
  });

  it("fetchOrdersByDatePage uses LIMIT/OFFSET", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ n: 3 }] })
      .mockResolvedValueOnce({ rows: [{ order_id: "o1" }] });
    const page = await import("./orders_store.js").then(m =>
      m.fetchOrdersByDatePage("2026-06-18", "550e8400-e29b-41d4-a716-446655440000", 1, 20),
    );
    expect(page.total).toBe(3);
    expect(queryMock).toHaveBeenCalledTimes(2);
    const [listSql] = queryMock.mock.calls[1];
    expect(listSql).toMatch(/LIMIT \$4 OFFSET \$5/);
    expect(listSql).toMatch(/ABS\(link\) >= 1000000000000/);
    expect(listSql).toMatch(/create_at >= \$2 AND create_at < \$3/);
  });

  it("fetchOrdersByPlayerOrderIds filters by order_id list", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await fetchOrdersByPlayerOrderIds(7, "user-1", ["o1", "O2"]);
    expect(queryMock).toHaveBeenCalledOnce();
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/lower\(order_id\) = ANY\(\$3::text\[\]\)/);
    expect(params).toEqual(["user-1", 7, ["o1", "o2"]]);
  });
});

describe("upsertOrders SQL", () => {
  beforeEach(() => {
    clientQueryMock.mockReset();
    connectMock.mockClear();
    clientQueryMock.mockResolvedValue({ rows: [{ was_inserted: false }] });
  });

  it("batch INSERT uses unnest with 14 column arrays", async () => {
    const ok = await upsertOrders([
      {
        user_id: "u1",
        player_id: 12,
        order_id: "o1",
        link: 1_781_890_412_000,
        provider: "OB",
        match: "A vs B",
        bet: "[地图1]获胜",
        item: "A",
        odds: 1.62,
        bet_money: 100,
        money: -100,
        status: "Lose",
        create_at: 1_781_890_412_099,
        raw: { status: "lose" },
      },
    ]);
    expect(ok).toBe(true);
    expect(connectMock).toHaveBeenCalledOnce();
    const insertCall = clientQueryMock.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO orders"));
    expect(insertCall).toBeDefined();
    const [sql, params] = insertCall;
    expect(sql).toMatch(/unnest\(/);
    expect(sql).toMatch(/\$14::jsonb\[\]/);
    expect(params).toHaveLength(14);
    expect(params[0]).toEqual(["u1"]);
    expect(params[2]).toEqual(["o1"]);
    expect(params[11]).toEqual(["Lose"]);
    expect(params[12]).toEqual([1_781_890_412_099]);
    expect(params[13][0]).toMatchObject({ status: "lose" });
  });

  it("upserts multiple rows in one INSERT", async () => {
    clientQueryMock.mockResolvedValue({
      rows: [
        { order_id: "o1", was_inserted: true },
        { order_id: "o2", was_inserted: false },
      ],
    });
    await upsertOrders([
      {
        user_id: "u1",
        player_id: 12,
        order_id: "o1",
        link: null,
        provider: "OB",
        match: "",
        bet: "",
        item: "",
        odds: 1,
        bet_money: 10,
        money: 0,
        status: "None",
        create_at: 1,
        raw: {},
      },
      {
        user_id: "u1",
        player_id: 12,
        order_id: "o2",
        link: null,
        provider: "OB",
        match: "",
        bet: "",
        item: "",
        odds: 2,
        bet_money: 20,
        money: 0,
        status: "None",
        create_at: 2,
        raw: {},
      },
    ]);
    const insertCalls = clientQueryMock.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO orders"));
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0][1][2]).toEqual(["o1", "o2"]);
  });

  it("dedupes duplicate order_id rows (last wins)", async () => {
    clientQueryMock.mockResolvedValue({ rows: [{ was_inserted: true }] });
    await upsertOrders([
      {
        user_id: "u1",
        player_id: 12,
        order_id: "dup",
        link: 1,
        provider: "OB",
        match: "",
        bet: "",
        item: "",
        odds: 1,
        bet_money: 10,
        money: 0,
        status: "None",
        create_at: 1,
        raw: { n: 1 },
      },
      {
        user_id: "u1",
        player_id: 12,
        order_id: "dup",
        link: 2,
        provider: "OB",
        match: "",
        bet: "",
        item: "",
        odds: 2,
        bet_money: 20,
        money: 0,
        status: "Win",
        create_at: 2,
        raw: { n: 2 },
      },
    ]);
    const insertCalls = clientQueryMock.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO orders"));
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0][1][2]).toEqual(["dup"]);
    expect(insertCalls[0][1][11]).toEqual(["Win"]);
  });
});

describe("updateOrderBind bound hook", () => {
  beforeEach(() => {
    queryMock.mockReset();
    setOrdersBoundHook(null);
  });

  it("fires when link changes from create_at placeholder to arb", async () => {
    const ca = 1_781_882_462_790;
    const prev = {
      user_id: "u1",
      order_id: "o1",
      player_id: 7,
      link: ca,
      create_at: ca,
      provider: "OB",
    };
    queryMock
      .mockResolvedValueOnce({ rows: [prev] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const hook = vi.fn();
    setOrdersBoundHook(hook);

    const ok = await updateOrderBind("o1", "u1", 1_700_000_000_000, { provider: "OB" });

    expect(ok).toBe(true);
    expect(hook).toHaveBeenCalledOnce();
    expect(hook.mock.calls[0][0][0].link).toBe(1_700_000_000_000);
  });

  it("fires when link changes from hash to arb", async () => {
    const prev = {
      user_id: "u1",
      order_id: "o1",
      player_id: 7,
      link: 12345,
      provider: "OB",
    };
    queryMock
      .mockResolvedValueOnce({ rows: [prev] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const hook = vi.fn();
    setOrdersBoundHook(hook);

    const ok = await updateOrderBind("o1", "u1", 1_700_000_000_000, { provider: "OB" });

    expect(ok).toBe(true);
    expect(hook).toHaveBeenCalledOnce();
    expect(hook.mock.calls[0][0][0].link).toBe(1_700_000_000_000);
  });

  it("does not fire when new link remains hash", async () => {
    const prev = { user_id: "u1", order_id: "o1", link: 12345, provider: "OB" };
    queryMock
      .mockResolvedValueOnce({ rows: [prev] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const hook = vi.fn();
    setOrdersBoundHook(hook);

    await updateOrderBind("o1", "u1", 99999, { provider: "OB" });

    expect(hook).not.toHaveBeenCalled();
  });

  it("does not fire when previous link was already arb", async () => {
    const prev = {
      user_id: "u1",
      order_id: "o1",
      link: 1_700_000_000_001,
      create_at: 1_781_890_412_000,
      provider: "OB",
    };
    queryMock
      .mockResolvedValueOnce({ rows: [prev] })
      .mockResolvedValueOnce({ rowCount: 1 });
    const hook = vi.fn();
    setOrdersBoundHook(hook);

    await updateOrderBind("o1", "u1", 1_700_000_000_002, { provider: "OB" });

    expect(hook).not.toHaveBeenCalled();
  });

  it("uPDATE uses $1 for link and $2+ for WHERE (no placeholder clash)", async () => {
    const prev = {
      user_id: "u1",
      order_id: "o1",
      link: 12345,
      provider: "OB",
    };
    queryMock
      .mockResolvedValueOnce({ rows: [prev] })
      .mockResolvedValueOnce({ rowCount: 1 });

    await updateOrderBind("o1", "u1", 1_700_000_000_000, { provider: "OB" });

    const updateCall = queryMock.mock.calls.find(([sql]) => String(sql).startsWith("UPDATE"));
    expect(updateCall).toBeDefined();
    const [sql, params] = updateCall;
    expect(sql).toBe(
      "UPDATE orders SET link = $1 WHERE user_id = $2 AND order_id = $3 AND provider = $4",
    );
    expect(params).toEqual([1_700_000_000_000, "u1", "o1", "OB"]);
  });

  it("returns false when order row is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const hook = vi.fn();
    setOrdersBoundHook(hook);

    const ok = await updateOrderBind("missing", "u1", 1_700_000_000_000);

    expect(ok).toBe(false);
    expect(hook).not.toHaveBeenCalled();
  });

  it("refuses rebinding order to far arb linkId", async () => {
    const ca = 1_783_195_621_000;
    const prev = {
      user_id: "u1",
      order_id: "0xfe933",
      player_id: 47,
      link: 1_783_195_619_962,
      create_at: ca,
      provider: "Polymarket",
    };
    queryMock.mockResolvedValueOnce({ rows: [prev] });
    const hook = vi.fn();
    setOrdersBoundHook(hook);

    const ok = await updateOrderBind("0xfe933", "u1", 1_783_199_338_220, { provider: "Polymarket" });

    expect(ok).toBe(false);
    expect(hook).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledOnce();
  });
});

describe("rebindOrderLink", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("updates single order when from link is newer than to link", async () => {
    const older = 1_700_000_000_100;
    const newer = 1_700_000_000_200;
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          order_id: "src",
          user_id: "u1",
          link: newer,
          provider: "OB",
          match: "A vs B",
          bet: "[地图1] 获胜",
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          order_id: "peer",
          user_id: "u1",
          link: older,
          match: "A vs B",
          bet: "[地图1] 让分",
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await rebindOrderLink("u1", "src", older);

    expect(result.ok).toBe(true);
    expect(result.fromLinkId).toBe(newer);
    expect(result.toLinkId).toBe(older);
    const updateCall = queryMock.mock.calls.find(([sql]) => String(sql).includes("UPDATE orders SET link"));
    expect(updateCall).toBeTruthy();
    expect(updateCall[1]).toEqual([older, "u1", "src"]);
  });

  it("refuses older→newer rebind", async () => {
    const older = 1_700_000_000_100;
    const newer = 1_700_000_000_200;
    queryMock.mockResolvedValueOnce({
      rows: [{
        order_id: "src",
        user_id: "u1",
        link: older,
        provider: "OB",
        match: "A vs B",
        bet: "[地图1] 获胜",
      }],
    });

    const result = await rebindOrderLink("u1", "src", newer);

    expect(result.ok).toBe(false);
    expect(result.msg).toMatch(/较新/);
    expect(queryMock).toHaveBeenCalledOnce();
  });

  it("refuses when target link has no peer orders", async () => {
    const older = 1_700_000_000_100;
    const newer = 1_700_000_000_200;
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          order_id: "src",
          user_id: "u1",
          link: newer,
          provider: "OB",
          match: "A vs B",
          bet: "[地图1] 获胜",
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await rebindOrderLink("u1", "src", older);

    expect(result.ok).toBe(false);
    expect(result.msg).toMatch(/目标 Link/);
  });

  it("allows rebind when match or map differs from target peers", async () => {
    const older = 1_700_000_000_100;
    const newer = 1_700_000_000_200;
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          order_id: "src",
          user_id: "u1",
          link: newer,
          provider: "OB",
          match: "A vs B",
          bet: "[地图1] 获胜",
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          order_id: "peer",
          user_id: "u1",
          link: older,
          match: "A vs B",
          bet: "[地图2] 获胜",
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await rebindOrderLink("u1", "src", older);

    expect(result.ok).toBe(true);
    expect(result.toLinkId).toBe(older);
  });
});

describe("fetchPlatformAnalytics SQL", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("excludes prediction sells from order counts and pending", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const { fetchPlatformAnalytics } = await import("./orders_store.js");
    await fetchPlatformAnalytics(1, 2, null);
    expect(queryMock).toHaveBeenCalledOnce();
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toMatch(/pmSide/);
    expect(sql).toMatch(/pfSide/);
    expect(sql).toMatch(/pmSellState/);
    expect(sql).toMatch(/pfSellState/);
    expect(sql).toMatch(/pmAttributedSellShares/);
    expect(sql).toMatch(/AND NOT \(/);
    expect(sql).not.toMatch(/COUNT\(\*\) FILTER \(WHERE status = 'None'\)/);
  });

  it("scopes user filter when userIds present", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const { fetchPlatformAnalytics } = await import("./orders_store.js");
    const userIds = ["u1"];
    await fetchPlatformAnalytics(1, 2, userIds);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/user_id = ANY\(\$4::uuid\[\]\)/);
    expect(params[3]).toEqual(userIds);
  });
});

describe("fetchArbPairAnalytics SQL", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("excludes prediction sells and dedupes per link/provider", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const { fetchArbPairAnalytics } = await import("./orders_store.js");
    await fetchArbPairAnalytics(1, 2, null);
    expect(queryMock).toHaveBeenCalledOnce();
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toMatch(/pmSide/);
    expect(sql).toMatch(/pfSide/);
    expect(sql).toMatch(/ROW_NUMBER\(\)/);
    expect(sql).toMatch(/profit_hedge/);
    expect(sql).toMatch(/profit_a_win_b_lose/);
    expect(sql).toMatch(/profit_a_lose_b_win/);
    expect(sql).toMatch(/a_win_b_lose/);
    expect(sql).toMatch(/a_lose_b_win/);
    expect(sql).toMatch(/profit_reject/);
    expect(sql).toMatch(/hedge_ok/);
    expect(sql).toMatch(/settled_pairs/);
    expect(sql).toMatch(/pending_a/);
    expect(sql).toMatch(/pmSellState/);
    expect(sql).toMatch(/FROM uniq a/);
  });
});

describe("fetchArbOddsAnalytics SQL", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("shares uniq CTE and sums pair net profit with settled both legs", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const { fetchArbOddsAnalytics } = await import("./orders_store.js");
    const out = await fetchArbOddsAnalytics(1000, 2000, null, "RAY");
    expect(out).toEqual({ buckets: [], summary: [] });
    expect(queryMock).toHaveBeenCalledTimes(2);
    const [bucketSql, bucketParams] = queryMock.mock.calls[0];
    const [summarySql, summaryParams] = queryMock.mock.calls[1];
    for (const sql of [bucketSql, summarySql]) {
      expect(sql).toMatch(/pmSide/);
      expect(sql).toMatch(/pfSide/);
      expect(sql).toMatch(/ROW_NUMBER\(\)/);
      expect(sql).toMatch(/FROM uniq a/);
      expect(sql).toMatch(/JOIN uniq o/);
      expect(sql).toMatch(/a\.provider = \$3/);
      expect(sql).toMatch(/o\.provider <> \$3/);
      expect(sql).toMatch(/a\.status = 'Win' AND o\.status = 'Lose'/);
      expect(sql).toMatch(/a\.status = 'Lose' AND o\.status = 'Win'/);
      expect(sql).toMatch(/anchor_status/);
      expect(sql).toMatch(/other_provider/);
      expect(sql).toMatch(/other_status/);
      expect(sql).toMatch(/other_wins/);
      expect(sql).toMatch(/profit_other_win/);
      expect(sql).toMatch(/SUM\(pair_money_cny\)/);
      expect(sql).not.toMatch(/anchor_money_cny/);
    }
    expect(bucketSql).toMatch(/anchor_odds_bucket/);
    expect(summarySql).toMatch(/min_anchor_odds/);
    expect(summarySql).toMatch(/max_anchor_odds/);
    expect(bucketParams.slice(0, 3)).toEqual([1000, 2000, "RAY"]);
    expect(summaryParams.slice(0, 3)).toEqual([1000, 2000, "RAY"]);
    expect(typeof bucketParams[3]).toBe("number");
    expect(typeof summaryParams[3]).toBe("number");
  });

  it("scopes user filter to legs alias when userIds present", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const { fetchArbOddsAnalytics } = await import("./orders_store.js");
    const userIds = ["u1", "u2"];
    await fetchArbOddsAnalytics(1000, 2000, userIds, "OB");
    expect(queryMock).toHaveBeenCalledTimes(2);
    for (const [sql, params] of queryMock.mock.calls) {
      expect(sql).toMatch(/o\.user_id = ANY\(\$5::uuid\[\]\)/);
      expect(sql).not.toMatch(/ob\.user_id/);
      expect(params.slice(0, 3)).toEqual([1000, 2000, "OB"]);
      expect(typeof params[3]).toBe("number");
      expect(params[4]).toEqual(userIds);
    }
  });
});

describe("fetchValueBetOrderAnalytics SQL", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("filters ABS(link) >= VALUE_BET_LINK_BASE and groups by provider / odds bucket", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const { fetchValueBetOrderAnalytics } = await import("./orders_store.js");
    const { VALUE_BET_LINK_BASE } = await import("../order_link_filter.js");
    const out = await fetchValueBetOrderAnalytics(1000, 2000, null);
    expect(out).toEqual({ byProvider: [], byOddsBucket: [] });
    expect(queryMock).toHaveBeenCalledTimes(2);
    const [providerSql, providerParams] = queryMock.mock.calls[0];
    const [bucketSql, bucketParams] = queryMock.mock.calls[1];
    for (const sql of [providerSql, bucketSql]) {
      expect(sql).toMatch(/ABS\(link\) >= \$4/);
      expect(sql).toMatch(/AVG\(odds\)/);
      expect(sql).toMatch(/total_profit/);
      expect(sql).toMatch(/pmSide/);
      expect(sql).toMatch(/pmSellState/);
      expect(sql).not.toMatch(/COUNT\(\*\) FILTER \(WHERE status = 'None'\)/);
    }
    expect(providerSql).toMatch(/GROUP BY provider/);
    expect(bucketSql).toMatch(/odds_bucket/);
    expect(bucketSql).toMatch(/GROUP BY odds_bucket, provider/);
    expect(bucketSql).toMatch(/1\.00-1\.49/);
    expect(providerParams.slice(0, 4)).toEqual([1000, 2000, expect.any(Number), VALUE_BET_LINK_BASE]);
    expect(bucketParams.slice(0, 4)).toEqual([1000, 2000, expect.any(Number), VALUE_BET_LINK_BASE]);
  });

  it("appends userIds filter as $5", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const { fetchValueBetOrderAnalytics } = await import("./orders_store.js");
    const userIds = ["u1"];
    await fetchValueBetOrderAnalytics(1000, 2000, userIds);
    expect(queryMock).toHaveBeenCalledTimes(2);
    for (const [sql, params] of queryMock.mock.calls) {
      expect(sql).toMatch(/user_id = ANY\(\$5::uuid\[\]\)/);
      expect(params[4]).toEqual(userIds);
    }
  });
});

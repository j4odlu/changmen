import { beforeEach, describe, expect, it, vi } from "vitest";
const persistSnapshot = vi.hoisted(() => vi.fn());
vi.mock("./ray_monitor_orders.js", () => ({ listRayMonitorOrders: vi.fn(async () => []) }));

vi.mock("../esport-api/store.js", () => ({
  default: {
    getAccountsForUser: vi.fn(() => [
      { accountId: 42, provider: "OB" }, // 故意写错，守卫应看 players
    ]),
    removeAccountForUser: vi.fn(),
    setAccountsForUser: vi.fn(async () => {}),
  },
}));

vi.mock("./player_ownership.js", () => ({
  assertPlayerOwnedByUser: vi.fn(async () => ({
    ok: true,
    player: {
      id: 42,
      platformName: "PredictFun",
      provider: "PredictFun",
      totalBalance: 100,
    },
  })),
  assertPlayersOwnedByUser: vi.fn(async () => ({
    ok: true,
    players: [{
      id: 42,
      platformName: "PredictFun",
      provider: "PredictFun",
      totalBalance: 100,
    }],
  })),
  isPredictFunPlayerRow: (player) => {
    const p = String(player?.provider ?? "").toLowerCase();
    if (p === "predictfun")
      return true;
    const n = String(player?.platformName ?? "").toLowerCase();
    return n.includes("predict");
  },
}));

vi.mock("./order_store.js", () => ({
  saveOrder: vi.fn(async () => true),
  listByPlayer: vi.fn(async () => []),
  scrubClientOrder: (o) => o,
  parseOrderBindRow: vi.fn(),
  saveOrderBind: vi.fn(),
  rebindOrderLink: vi.fn(),
  listByDatePage: vi.fn(),
  listUserProfitRank: vi.fn(),
}));

vi.mock("./account_store.js", () => ({
  updatePlayerBalance: vi.fn(async () => ({ total: 1, platformId: 1, platformName: "PredictFun" })),
  debitPlayerBalance: vi.fn(async () => ({ total: 90 })),
  creditPlayerBalance: vi.fn(async () => ({ total: 110 })),
  getPlayer: vi.fn(),
  listMoneyLogs: vi.fn(),
  getMoneyLog: vi.fn(),
  saveMoneyLog: vi.fn(),
  deleteMoneyLog: vi.fn(),
  deletePlayer: vi.fn(),
  deletePlayerData: vi.fn(),
  createTagPlatform: vi.fn(),
  listTagPlatforms: vi.fn(),
  saveUserLog: vi.fn(),
  prunePlayersNotInList: vi.fn(),
}));

vi.mock("../db/store.js", () => ({
  listProfileRows: vi.fn(() => []),
  loadAccountsForUser: vi.fn(),
  prepareAccountsForSave: vi.fn(async () => [{ accountId: 42 }]),
  saveAccountsTransactionForUser: vi.fn(async (uid, _ids, prepare) => {
    const records = await prepare({ existing: [{ accountId: 42, provider: "OB" }], players: [] });
    persistSnapshot(uid, records);
    return records;
  }),
}));

vi.mock("@changmen/shared/account_multiply", () => ({
  normalizeAccountMultiplyField: (v) => v,
  preserveStoredAccountMultiply: (a) => ({ ...a }),
}));

vi.mock("@changmen/db/venue_account_key.js", () => ({
  VenueAccountKeyConflictError: class extends Error {},
  isVenueAccountKeyUniqueViolation: () => false,
}));

vi.mock("../integrations/polymarket/balance.js", () => ({
  fetchPolymarketCollateralBalance: vi.fn(),
}));

vi.mock("../integrations/polymarket/clob_proxy.js", () => ({
  executePolymarketHttpRequest: vi.fn(),
  pickPolymarketPolyHeaders: vi.fn(),
}));

vi.mock("../esport-api/stubs.js", () => ({
  emptyPage: () => ({ list: [], total: 0 }),
}));

vi.mock("../esport-api/user_kv.js", () => ({
  emptyDirectValue: () => null,
  isArrayKey: () => false,
  wrapObjectDirect: (v) => v,
}));

vi.mock("./balance_provider.js", () => ({
  enrichAccountFromPlatformDefaults: (a) => a,
  getAccountBalance: vi.fn(),
}));

vi.mock("./user_presence.js", () => ({
  resolvePresenceState: () => ({}),
}));

describe("PredictFun client write guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes a successfully deleted account before asynchronous log cleanup, even if cleanup fails", async () => {
    const { handleDeletePlayer } = await import("./account_service.js");
    const accountStore = await import("./account_store.js");
    const store = (await import("../esport-api/store.js")).default;
    accountStore.deletePlayer.mockResolvedValueOnce(true);
    accountStore.deletePlayerData.mockImplementationOnce(async () => {
      expect(store.removeAccountForUser).toHaveBeenCalledWith("u1", 42);
      throw new Error("cleanup failed");
    });
    await expect(handleDeletePlayer({ playerId: 42 }, "u1")).rejects.toThrow("cleanup failed");
    store.removeAccountForUser.mockClear();
    accountStore.deletePlayer.mockResolvedValueOnce(false);
    expect((await handleDeletePlayer({ playerId: 42 }, "u1")).ok).toBe(false);
    expect(store.removeAccountForUser).not.toHaveBeenCalled();
  });

  it("isPredictFunClientSaveOrderRequest uses players identity even if ACCOUNT.provider forged", async () => {
    const { isPredictFunClientSaveOrderRequest } = await import("./account_service.js");
    expect(isPredictFunClientSaveOrderRequest(
      { type: "OB" },
      [{ provider: "OB" }],
      { id: 42, provider: "PredictFun", platformName: "PredictFun" },
    )).toBe(true);
    expect(isPredictFunClientSaveOrderRequest(
      { type: "OB" },
      [{ provider: "OB" }],
      { id: 7, provider: "OB", platformName: "OB" },
    )).toBe(false);
  });

  it("handleSaveOrder rejects PredictFun writes", async () => {
    const { handleSaveOrder } = await import("./account_service.js");
    const orderStore = await import("./order_store.js");

    const rejected = await handleSaveOrder({
      playerId: 42,
      type: "PredictFun",
      orders: JSON.stringify([{ orderId: "x", provider: "PredictFun", pfHoldShares: 999 }]),
    }, "u1");

    expect(rejected.ok).toBe(false);
    expect(String(rejected.msg)).toMatch(/禁止 Client_SaveOrder/);
    expect(orderStore.saveOrder).not.toHaveBeenCalled();
  });

  it("handleUpdateBalance rejects PredictFun even if ACCOUNT.provider was forged", async () => {
    const { handleUpdateBalance } = await import("./account_service.js");
    const accountStore = await import("./account_store.js");

    const rejected = await handleUpdateBalance({
      playerId: 42,
      balance: 99999,
    }, "u1");

    expect(rejected.ok).toBe(false);
    expect(String(rejected.msg)).toMatch(/禁止 Client_UpdateBalance/);
    expect(accountStore.updatePlayerBalance).not.toHaveBeenCalled();
  });

  it("handleSaveAccounts keeps PredictFun total_balance from players (ignores client 0/omit)", async () => {
    const store = (await import("../esport-api/store.js")).default;
    const { handleSaveAccounts } = await import("./account_service.js");

    const saved = await handleSaveAccounts([
      {
        accountId: 42,
        provider: "OB",
        platformName: "PredictFun",
        playerName: "GB12",
        // 故意不传 balance / 或传 0：不得覆盖 RDS 账本
        balance: 0,
        credit: 999,
      },
    ], "u1");

    expect(saved.ok).toBe(true);
    expect(persistSnapshot).toHaveBeenCalled();
    const payload = persistSnapshot.mock.calls[0][1];
    expect(payload[0].provider).toBe("PredictFun");
    expect(payload[0].balance).toBe(100);
    expect(payload[0].totalBalance).toBe(100);
    expect(payload[0].credit).toBe(0);
  });

  it("handleSaveAccounts migrates legacy PF credit when total_balance is 0", async () => {
    const ownership = await import("./player_ownership.js");
    // validateAccountRows + handleSaveAccounts 各调一次
    ownership.assertPlayersOwnedByUser.mockResolvedValue({
      ok: true,
      players: [{
        id: 42,
        platformName: "PredictFun",
        provider: "PredictFun",
        totalBalance: 0,
        credit: 88.5,
      }],
    });
    const store = (await import("../esport-api/store.js")).default;
    const { handleSaveAccounts } = await import("./account_service.js");

    const saved = await handleSaveAccounts([
      { accountId: 42, provider: "PredictFun", balance: 0, credit: 0 },
    ], "u1");

    expect(saved.ok).toBe(true);
    const payload = persistSnapshot.mock.calls.at(-1)[1];
    expect(payload[0].balance).toBe(88.5);
    expect(payload[0].credit).toBe(0);
  });

  it("handleGetPlayerOrder skips money logs and passes sinceCreateAt for PM sync", async () => {
    const { handleGetPlayerOrder } = await import("./account_service.js");
    const orderStore = await import("./order_store.js");
    const accountStore = await import("./account_store.js");
    orderStore.listByPlayer.mockResolvedValue([{ orderId: "pm1", Type: "Polymarket" }]);

    const out = await handleGetPlayerOrder({
      playerId: 42,
      sinceCreateAt: 1_700_000_000_000,
      includeLogs: false,
    }, "u1");

    expect(out.ok).toBe(true);
    expect(out.info.logs).toEqual([]);
    expect(out.info.orders).toEqual([{ orderId: "pm1", Type: "Polymarket" }]);
    expect(accountStore.listMoneyLogs).not.toHaveBeenCalled();
    expect(orderStore.listByPlayer).toHaveBeenCalledWith(42, "u1", { sinceCreateAt: 1_700_000_000_000 });
  });

  it("RAY recovery enforces ownership before its strict read and bypasses logs and normal account history", async () => {
    const { handleGetPlayerOrder } = await import("./account_service.js");
    const { listRayMonitorOrders } = await import("./ray_monitor_orders.js");
    const { assertPlayerOwnedByUser } = await import("./player_ownership.js");
    const { listMoneyLogs } = await import("./account_store.js");
    const { listByPlayer } = await import("./order_store.js");
    const body = { playerId: 42, rayMonitorOnly: true, orderIds: ["original"] };
    assertPlayerOwnedByUser.mockResolvedValueOnce({ ok: false, msg: "not owned" });
    expect(await handleGetPlayerOrder(body, "foreign")).toMatchObject({ ok: false });
    expect(listRayMonitorOrders).not.toHaveBeenCalled();
    expect(await handleGetPlayerOrder(body, "owner")).toMatchObject({ ok: true, info: { logs: [], orders: [] } });
    expect(listRayMonitorOrders).toHaveBeenCalledWith(42, "owner", ["original"]);
    expect(listMoneyLogs).not.toHaveBeenCalled(); expect(listByPlayer).not.toHaveBeenCalled();
  });

  it("handleGetPlayerOrder default still loads money logs and full orders", async () => {
    const { handleGetPlayerOrder } = await import("./account_service.js");
    const orderStore = await import("./order_store.js");
    const accountStore = await import("./account_store.js");
    accountStore.listMoneyLogs.mockResolvedValue({ data: [{
      logId: 1,
      type: "in",
      money: 10,
      currency: "CNY",
      description: "x",
      createAt: 1,
    }] });
    orderStore.listByPlayer.mockResolvedValue([]);

    const out = await handleGetPlayerOrder({ playerId: 42 }, "u1");

    expect(out.ok).toBe(true);
    expect(out.info.logs).toHaveLength(1);
    expect(accountStore.listMoneyLogs).toHaveBeenCalled();
    expect(orderStore.listByPlayer).toHaveBeenCalledWith(42, "u1", undefined);
  });
});

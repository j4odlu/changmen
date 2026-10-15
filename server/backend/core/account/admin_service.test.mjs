import { describe, expect, it, vi } from "vitest";

import {
  deleteAdminOrders,
  getAdminUserConfigDetail,
  listAdminOrders,
  parseAdminOrderIdList,
  parseFormBool,
  profileSettingForAdmin,
  renameAdminUser,
  sanitizeAccountForAdmin,
  sanitizeSettingForAdmin,
  updateAdminUserBetTarget,
} from "./admin_service.js";
import { lastLoginFieldsFromProfile } from "./user_login_meta.js";

vi.mock("@changmen/db", () => ({
  fetchOrdersAdminPage: vi.fn(async () => ({
    rows: [
      { id: 1, user_id: "u1", order_id: "o1", link: 0, create_at: new Date(2026, 5, 13, 1).getTime(), raw: {} },
      { id: 2, user_id: "u1", order_id: "o2", link: 0, create_at: new Date(2026, 5, 13, 2).getTime(), raw: {} },
      {
        id: 3,
        user_id: "u1",
        player_id: 146,
        order_id: "0xpmbuy",
        link: new Date(2026, 5, 13, 3).getTime(),
        provider: "Polymarket",
        match: "Counter-Strike: Heroic vs K27 - Map 4 Winner",
        bet: "地图4",
        item: "Heroic",
        odds: 2,
        bet_money: 0,
        money: 0,
        status: "None",
        create_at: new Date(2026, 5, 13, 3).getTime(),
        raw: {
          pmSide: "buy",
          pmSellState: "closed",
          pmStakeUsdc: 0,
          pmShares: 57.66,
          pmAttributedSellShares: 57.66,
          pmFillPrice: 0.5,
          pmOrigin: "changmen",
        },
      },
    ],
    total: 3,
  })),
  ensurePgPoolReady: vi.fn(async () => {}),
  fetchProfileById: vi.fn(async (id) => (
    id === "u1"
      ? {
          id: "u1",
          user_name: "alice",
          betting_config: { BetTarget: true },
          collect_config: {},
          preferences: {},
        }
      : null
  )),
  fetchProfilesAdmin: vi.fn(async () => [
    {
      id: "u1",
      user_name: "alice",
      is_admin: false,
      role: "user",
      team_id: "t1",
      betting_config: { betting: true, betMoney: 200 },
      collect_config: { collect: [["OB", true]], log: false },
      preferences: {
        Follow: "{\"users\":[\"bob\"]}",
        PROXY: "[{\"proxyId\":1,\"password\":\"secret\"}]",
        Message: "{\"telegramId\":\"123\"}",
        lastLoginIp: "203.0.113.1",
        lastLoginAt: 1700000000000,
      },
      created_at: 10,
      updated_at: 20,
    },
    {
      id: "u2",
      user_name: "bob",
      is_admin: false,
      role: "user",
      team_id: "t2",
      betting_config: {},
      collect_config: {},
      preferences: {},
      created_at: 10,
      updated_at: 20,
    },
  ]),
  updateUserName: vi.fn(async () => true),
  deleteOrdersByIds: vi.fn(async ids => ids.length),
  fetchOrdersByLinks: vi.fn(async () => []),
  fetchOrdersByUserOrderIds: vi.fn(async () => []),
  fetchPredictionSellsByBuyOrderIds: vi.fn(async () => []),
  fetchPlayersByIdsIncludingDeleted: vi.fn(async () => []),
  // rowToOrder → resolveStoredLink 需要（link=0 时）
  placeholderLinkFromCreateAt: (ca) => Number(ca) || 0,
  backendBindLinkFromCreateAt: (ca) => Number(ca) || 0,
  isArbBindLink: () => false,
}));

vi.mock("@changmen/db/admin_users.js", () => ({
  readManagedUserIdentity: vi.fn(async () => ({ user_name: "alice" })),
  hasManagedUserName: vi.fn(async name => name === "bob"),
}));

const mockProfileRow = vi.hoisted(() => ({
  id: "u1",
  user_name: "alice",
  betting_config: { BetTarget: true },
  collect_config: {},
  preferences: {},
}));

vi.mock("../db/store.js", () => ({
  loadProfileById: vi.fn(async () => null),
  loadAccountsForUser: vi.fn(async () => []),
  listProfileRows: vi.fn(() => [mockProfileRow]),
}));

const mockGetAccountsForUser = vi.fn(() => []);
const mockUpdateAccountForUser = vi.fn(() => null);
const mockUpdateUserSetting = vi.fn((uid, patch) => {
  if (patch?.BetTarget !== undefined) {
    mockProfileRow.betting_config = { ...mockProfileRow.betting_config, BetTarget: patch.BetTarget };
  }
  return { id: uid, userName: "alice" };
});

vi.mock("../esport-api/store.js", () => ({
  default: {
    getAccountsForUser: (...args) => mockGetAccountsForUser(...args),
    updateAccountForUser: (...args) => mockUpdateAccountForUser(...args),
    updateUserSetting: (...args) => mockUpdateUserSetting(...args),
  },
}));

vi.mock("../auth/role_filter.js", () => ({
  getVisibleUserIds: vi.fn(async () => null),
  resolveVisibleUserIds: vi.fn((caller) => {
    if (caller?.role === "leader")
      return new Set(["u1"]);
    return null;
  }),
  filterProfiles: vi.fn((profiles, visibleIds) =>
    visibleIds ? profiles.filter(p => visibleIds.has(String(p.id))) : profiles,
  ),
}));

describe("listAdminOrders", () => {
  it("maps multiple rows without treating array index as startIndex", async () => {
    const page = await listAdminOrders({ date: "2026-06-13", pageIndex: 1, pageSize: 50 });
    expect(page.list).toHaveLength(3);
    expect(page.list.map(r => r.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(page.total).toBe(3);
  });

  it("allows pageSize up to 5000 (no 200 cap)", async () => {
    const page = await listAdminOrders({ date: "2026-06-13", pageIndex: 1, pageSize: 5000 });
    expect(page.pageSize).toBe(5000);
    expect(page.hasMore).toBe(false);
  });

  it("passes through Polymarket raw fields for workbench-parity display", async () => {
    const page = await listAdminOrders({ date: "2026-06-13", pageIndex: 1, pageSize: 50 });
    const pm = page.list.find(r => r.orderId === "0xpmbuy");
    expect(pm).toMatchObject({
      provider: "Polymarket",
      betMoney: 0,
      money: 0,
      status: "None",
      pmSide: "buy",
      pmSellState: "closed",
      pmStakeUsdc: undefined,
      pmShares: 57.66,
      pmAttributedSellShares: 57.66,
      pmFillPrice: 0.5,
      pmOrigin: "changmen",
    });
  });
});

describe("sanitizeAccountForAdmin", () => {
  it("returns full credentials and betting fields for admin APIs", () => {
    const row = sanitizeAccountForAdmin({
      accountId: 12,
      platform: "OB",
      playerName: "tester",
      token: "secret-token",
      cookie: "secret-cookie",
      referer: "https://ob.example/",
      userAgent: "Mozilla/5.0",
      balance: 1000,
      minOdds: 1.3,
      maxOdds: 5,
      profit: 1.03,
      city: "上海",
      maxBalanceOdds: 2.5,
      lastOdds: true,
      game: { LOL: { betCount: 2, profit: 1.05, odds: ["1.9"] } },
      gateway: "https://api.example.com/v1",
    });
    expect(row.hasCredentials).toBe(true);
    expect(row.token).toBe("secret-token");
    expect(row.cookie).toBe("secret-cookie");
    expect(row.referer).toBe("https://ob.example/");
    expect(row.userAgent).toBe("Mozilla/5.0");
    expect(row.gateway).toBe("https://api.example.com/v1");
    expect(row.balance).toBe(1000);
    expect(row.gatewayHost).toBe("api.example.com");
    expect(row.city).toBe("上海");
    expect(row.maxBalanceOdds).toBe(2.5);
    expect(row.lastOdds).toBe(true);
    expect(row.game.LOL.betCount).toBe(2);
  });
});

describe("sanitizeSettingForAdmin", () => {
  it("returns setting object copy", () => {
    const s = sanitizeSettingForAdmin({ betting: true, betMoney: 100 });
    expect(s).toEqual({ betting: true, betMoney: 100 });
  });
});

describe("profileSettingForAdmin", () => {
  it("merges betting_config, collect_config and preferences", () => {
    const s = profileSettingForAdmin({
      betting_config: { betting: true, betMoney: 200 },
      collect_config: { OB: true, RAY: false },
      preferences: { Follow: "on" },
    });
    expect(s.betting).toBe(true);
    expect(s.betMoney).toBe(200);
    expect(s.Follow).toBe("on");
    expect(s.CollectConfig).toEqual({ OB: true, RAY: false });
  });

  it("hides system preference keys from admin setting view", () => {
    const s = profileSettingForAdmin({
      betting_config: { betMoney: 100 },
      preferences: { lastLoginIp: "1.2.3.4", lastLoginAt: 1, Follow: "on" },
    });
    expect(s.lastLoginIp).toBeUndefined();
    expect(s.Follow).toBe("on");
  });

  it("normalizes string BetTarget from legacy rows", () => {
    expect(profileSettingForAdmin({
      betting_config: { BetTarget: "false" },
    }).BetTarget).toBe(false);
    expect(profileSettingForAdmin({
      betting_config: { BetTarget: "true" },
    }).BetTarget).toBe(true);
  });
});

describe("getAdminUserConfigDetail", () => {
  it("returns grouped parsed configs and masks sensitive account fields", async () => {
    mockGetAccountsForUser.mockReturnValueOnce([
      {
        accountId: 12,
        provider: "OB",
        playerName: "ob-main",
        token: "secret-token",
        cookie: "secret-cookie",
        balance: 100,
      },
    ]);
    const detail = await getAdminUserConfigDetail("u1", { id: "admin", role: "admin", isAdmin: true });
    expect(detail.configs.USERCONFIG.betMoney).toBe(200);
    expect(detail.configs.CollectConfig.collect).toEqual([["OB", true]]);
    expect(detail.configs.preferences.Follow).toEqual({ users: ["bob"] });
    expect(detail.configs.preferences.PROXY[0].password).toMatchObject({
      masked: true,
      hasValue: true,
    });
    expect(detail.configs.ACCOUNT[0].token).toMatchObject({
      masked: true,
      hasValue: true,
    });
    expect(detail.configs.ACCOUNT[0].cookie).toMatchObject({
      masked: true,
      hasValue: true,
    });
    expect(detail.raw.preferences.lastLoginIp).toBe("203.0.113.1");
    expect(detail.raw.preferences.PROXY[0].password).toMatchObject({
      masked: true,
      hasValue: true,
    });
  });

  it("rejects users outside leader visibility", async () => {
    await expect(
      getAdminUserConfigDetail("u2", { id: "leader", role: "leader", teamId: "t1" }),
    ).rejects.toThrow("无权查看该用户");
  });
});

describe("lastLoginFieldsFromProfile", () => {
  it("reads last login ip and time from preferences", () => {
    expect(
      lastLoginFieldsFromProfile({
        preferences: { lastLoginIp: "203.0.113.1", lastLoginAt: 1700000000000 },
      }),
    ).toEqual({ lastLoginIp: "203.0.113.1", lastLoginAt: 1700000000000 });
  });
});

describe("deleteAdminOrders", () => {
  it("deletes by orderIds array", async () => {
    const result = await deleteAdminOrders({ orderIds: [1, 2] });
    expect(result.deleted).toBe(2);
  });

  it("parses JSON-stringified orderIds from form body", async () => {
    expect(parseAdminOrderIdList("[773279,773280]")).toEqual([773279, 773280]);
    const result = await deleteAdminOrders({ orderIds: "[773279,773280]" });
    expect(result.deleted).toBe(2);
  });

  it("rejects empty ids", async () => {
    await expect(deleteAdminOrders({ orderIds: [] })).rejects.toThrow("删除失败");
  });
});

describe("renameAdminUser", () => {
  it("rejects empty user name", async () => {
    await expect(renameAdminUser("u1", "  ")).rejects.toThrow("用户名必填");
  });

  it("rejects duplicate user name", async () => {
    await expect(renameAdminUser("u1", "bob")).rejects.toThrow("用户名已存在");
  });

  it("renames user when name is available", async () => {
    const result = await renameAdminUser("u1", "carol");
    expect(result).toEqual({ id: "u1", userName: "carol" });
  });
});

describe("parseFormBool", () => {
  it("parses form-encoded false correctly", () => {
    expect(parseFormBool("false")).toBe(false);
    expect(parseFormBool("0")).toBe(false);
    expect(parseFormBool(0)).toBe(false);
    expect(parseFormBool(false)).toBe(false);
  });

  it("parses form-encoded true correctly", () => {
    expect(parseFormBool("true")).toBe(true);
    expect(parseFormBool("1")).toBe(true);
    expect(parseFormBool(1)).toBe(true);
    expect(parseFormBool(true)).toBe(true);
  });
});

describe("updateAdminUserBetTarget", () => {
  it("writes BetTarget into betting_config", async () => {
    mockUpdateUserSetting.mockClear();
    const result = await updateAdminUserBetTarget("u1", true);
    expect(mockUpdateUserSetting).toHaveBeenCalledWith("u1", { BetTarget: true });
    expect(result.setting.BetTarget).toBe(true);
    expect(result.betTarget).toBe(true);
    expect(result.userName).toBe("alice");
  });

  it("writes BetTarget false when disabled", async () => {
    mockUpdateUserSetting.mockClear();
    mockProfileRow.betting_config = { BetTarget: true };
    const result = await updateAdminUserBetTarget("u1", "false");
    expect(mockUpdateUserSetting).toHaveBeenCalledWith("u1", { BetTarget: false });
    expect(result.betTarget).toBe(false);
    expect(result.setting.BetTarget).toBe(false);
  });
});

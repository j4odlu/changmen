import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  available: true, query: vi.fn(), ready: vi.fn(), profile: vi.fn(), insert: vi.fn(),
  rename: vi.fn(), admin: vi.fn(), role: vi.fn(), team: vi.fn(), teams: vi.fn(),
  deleteTeam: vi.fn(), reload: vi.fn(), visible: vi.fn(),
}));
vi.mock("../../../db/rds/common.js", async original => ({ ...await original(), getPgPool: () => m.available ? { query: m.query } : null }));
vi.mock("../../../db/pg_pool.js", async original => ({ ...await original(), ensurePgPoolReady: (...args) => m.ready(...args) }));
vi.mock("../../../db/rds/profile_store.js", async original => ({ ...await original(), insertProfile: (...args) => m.insert(...args) }));
vi.mock("@changmen/db", async original => ({
  ...await original(), getPgPool: () => m.available ? { query: m.query } : null,
  ensurePgPoolReady: (...args) => m.ready(...args), insertProfile: (...args) => m.insert(...args),
  fetchProfileById: (...args) => m.profile(...args), updateUserName: (...args) => m.rename(...args),
  updateUserIsAdmin: (...args) => m.admin(...args), updateUserRole: (...args) => m.role(...args),
  updateUserTeamId: (...args) => m.team(...args), fetchTeams: (...args) => m.teams(...args),
  deleteTeam: (...args) => m.deleteTeam(...args),
}));
vi.mock("../db/store.js", () => ({ loadProfileById: (...args) => m.reload(...args), listProfileRows: () => [], loadAccountsForUser: async () => [] }));
vi.mock("../esport-api/store.js", () => ({ default: {} }));
vi.mock("../auth/role_filter.js", () => ({ getVisibleUserIds: (...args) => m.visible(...args), filterProfiles: x => x, resolveVisibleUserIds: () => null }));

import { createAdminUser, deleteAdminUser, renameAdminUser, resetAdminUserPassword, setAdminUserAdmin, setAdminUserRole, deleteTeam } from "./admin_service.js";
import { handleAdminAction } from "../esport-api/admin_routes.ts";

beforeEach(() => {
  vi.resetAllMocks(); m.available = true;
  m.ready.mockResolvedValue(undefined);
  m.query.mockResolvedValue({ rows: [], rowCount: 1 });
  m.insert.mockResolvedValue(true);
  m.profile.mockResolvedValue({ id: "u", user_name: "alice", is_admin: false, role: "user", team_id: null });
  for (const fn of [m.rename, m.admin, m.role, m.team, m.deleteTeam]) fn.mockResolvedValue(true);
  m.teams.mockResolvedValue([{ id: "t1" }]); m.visible.mockResolvedValue(new Set(["u"]));
});

describe("managed-user route envelopes and aliases", () => {
  const caller = { user: { id: "operator", userName: "operator", role: "admin", isAdmin: true } };
  const wire = async (action, body) => JSON.parse(JSON.stringify(await handleAdminAction(action, body, caller)));
  it.each([
    ["Client_AdminCreateUser", { username: " alice ", password: "123456" }, { id: expect.any(String), userName: "alice" }],
    ["Client_AdminRenameUser", { id: "u", username: "Alice" }, { id: "u", userName: "Alice" }],
    ["Client_AdminResetPassword", { id: "u", password: "123456" }, { id: "u", userName: "alice" }],
    ["Client_AdminDeleteUser", { id: "u" }, { id: "u", userName: "alice" }],
    ["Client_AdminSetUserAdmin", { id: "u", isAdmin: "1" }, { id: "u", userName: "alice", isAdmin: 1 }],
    ["Client_AdminSetUserRole", { id: "u", role: "user" }, { id: "u", userName: "alice", role: "user", teamId: null, isAdmin: 0 }],
    ["Client_AdminDeleteTeam", { teamId: "t1" }, { id: "t1" }],
  ])("retains serialized success output for %s", async (action, body, info) => {
    m.query.mockImplementation(async sql => ({ rows: /FROM users WHERE id/.test(sql) ? [{ user_name: "alice", is_admin: false }] : [], rowCount: 1 }));
    expect(await wire(action, body)).toEqual({ success: 1, msg: "ok", info });
  });
  it.each([
    ["Client_AdminCreateUser", { username: "alice", password: "123456" }, "RDS 未配置，无法创建用户"],
    ["Client_AdminRenameUser", { id: "u", username: "Alice" }, "RDS 未配置"],
    ["Client_AdminResetPassword", { id: "u", password: "123456" }, "RDS 未配置"],
    ["Client_AdminDeleteUser", { id: "u" }, "RDS 未配置"],
  ])("retains storage failure envelope for %s", async (action, body, msg) => {
    m.available = false; expect(await wire(action, body)).toEqual({ success: 0, msg, info: null });
  });
  it("preserves the existing form boolean interpretation", async () => {
    expect(await wire("Client_AdminSetUserAdmin", { id: "u", isAdmin: "true" })).toEqual({ success: 1, msg: "ok", info: { id: "u", userName: "alice", isAdmin: 0 } });
    expect(m.admin).not.toHaveBeenCalled();
  });
  it("preserves last-admin failure through the actual route", async () => {
    m.profile.mockResolvedValue({ user_name: "alice", role: "admin", is_admin: true });
    m.query.mockResolvedValue({ rows: [{ n: 1 }] });
    expect(await wire("Client_AdminSetUserRole", { id: "u", role: "user" })).toEqual({ success: 0, msg: "至少保留一名管理员", info: null });
  });
});

describe("managed users: compatibility before database extraction", () => {
  it.each([
    [() => createAdminUser(" ", "123456"), "用户名必填"],
    [() => createAdminUser("bad-name", "123456"), "用户名仅支持"],
    [() => createAdminUser("alice", "short"), "密码至少 6 位"],
    [() => deleteAdminUser(" ", "op"), "用户 ID 无效"],
    [() => deleteAdminUser(" u ", "u"), "不能删除当前登录账号"],
    [() => renameAdminUser("u", "new", { role: "user" }), "仅管理员可更改用户名"],
    [() => setAdminUserAdmin("u", false, "u"), "不能取消当前登录账号"],
    [() => setAdminUserRole("u", "invalid"), "无效角色"],
  ])("validates before touching storage (%#)", async (run, message) => {
    await expect(run()).rejects.toThrow(message); expect(m.query).not.toHaveBeenCalled();
  });
  it("creates users before profiles, retaining ID, password and timestamp mapping", async () => {
    const result = await createAdminUser(" 用户_1 ", "123456");
    expect(result).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), userName: "用户_1" });
    expect(m.query.mock.calls[0]).toEqual([expect.stringContaining("lower(user_name) = lower($1)"), ["用户_1"]]);
    expect(m.query.mock.calls[1]).toEqual([expect.stringContaining("crypt($3, gen_salt('bf', 12))"), [result.id, "用户_1", "123456", expect.any(Number)]]);
    expect(m.insert).toHaveBeenCalledWith(result.id, { id: result.id, user_name: "用户_1", accounts: [], betting_config: {}, collect_config: {}, preferences: {}, created_at: m.query.mock.calls[1][1][3], updated_at: m.query.mock.calls[1][1][3] });
    expect(m.query.mock.invocationCallOrder[1]).toBeLessThan(m.insert.mock.invocationCallOrder[0]);
  });
  it("rejects duplicates before user or profile insertion", async () => {
    m.query.mockResolvedValueOnce({ rows: [{ id: "existing" }] });
    await expect(createAdminUser("alice", "123456")).rejects.toThrow("用户名已存在");
    expect(m.query).toHaveBeenCalledTimes(1); expect(m.insert).not.toHaveBeenCalled();
  });
  it("keeps profile creation failure visible", async () => {
    m.insert.mockResolvedValue(false);
    await expect(createAdminUser("alice", "123456")).rejects.toThrow("profiles 创建失败");
  });
  it.each([
    [() => createAdminUser("alice", "123456"), "RDS 未配置，无法创建用户"],
    [() => deleteAdminUser("u"), "RDS 未配置"],
    [() => renameAdminUser("u", "new"), "RDS 未配置"],
    [() => resetAdminUserPassword("u", "123456"), "RDS 未配置"],
  ])("keeps unavailable-storage errors (%#)", async (run, message) => {
    m.available = false; await expect(run()).rejects.toThrow(message); expect(m.query).not.toHaveBeenCalled();
  });
  it.each([deleteAdminUser, id => renameAdminUser(id, "new"), id => resetAdminUserPassword(id, "123456")])("rejects missing users (%#)", async run => {
    await expect(run("missing")).rejects.toThrow("用户不存在"); expect(m.query).toHaveBeenCalledTimes(1);
  });
  it("deletes a non-admin with the original response and no extra cache reload", async () => {
    m.query.mockResolvedValueOnce({ rows: [{ user_name: "alice", is_admin: false }] });
    expect(await deleteAdminUser(" u ")).toEqual({ id: "u", userName: "alice" });
    expect(m.query.mock.calls[1]).toEqual(["DELETE FROM users WHERE id = $1", ["u"]]); expect(m.reload).not.toHaveBeenCalled();
  });
  it("refuses to delete the last administrator", async () => {
    m.query.mockResolvedValueOnce({ rows: [{ user_name: "admin", is_admin: true }] }).mockResolvedValueOnce({ rows: [{ n: 1 }] });
    await expect(deleteAdminUser("u")).rejects.toThrow("至少保留一名管理员"); expect(m.query).toHaveBeenCalledTimes(2);
  });
  it("can delete an administrator when another remains", async () => {
    m.query.mockResolvedValueOnce({ rows: [{ user_name: "admin", is_admin: true }] }).mockResolvedValueOnce({ rows: [{ n: 2 }] });
    expect(await deleteAdminUser("u")).toEqual({ id: "u", userName: "admin" }); expect(m.query).toHaveBeenCalledTimes(3);
  });
  it("keeps exact-name no-op and case-only rename semantics", async () => {
    m.query.mockResolvedValue({ rows: [{ user_name: "alice" }] });
    expect(await renameAdminUser("u", "alice")).toEqual({ id: "u", userName: "alice" }); expect(m.rename).not.toHaveBeenCalled();
    expect(await renameAdminUser("u", "Alice")).toEqual({ id: "u", userName: "Alice" });
    expect(m.query).toHaveBeenCalledTimes(2); expect(m.rename).toHaveBeenCalledWith("u", "Alice"); expect(m.reload).toHaveBeenCalledWith("u");
  });
  it("rejects rename conflicts without publishing a cached profile", async () => {
    m.query.mockResolvedValueOnce({ rows: [{ user_name: "alice" }] }).mockResolvedValueOnce({ rows: [{ id: "other" }] });
    await expect(renameAdminUser("u", "taken")).rejects.toThrow("用户名已存在"); expect(m.rename).not.toHaveBeenCalled(); expect(m.reload).not.toHaveBeenCalled();
  });
  it("waits for confirmed rename before cache reload", async () => {
    m.query.mockResolvedValueOnce({ rows: [{ user_name: "alice" }] });
    let finish; m.rename.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = renameAdminUser("u", "new"); await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(m.reload).not.toHaveBeenCalled(); finish(true); await pending; expect(m.reload).toHaveBeenCalledWith("u");
  });
  it("password reset respects caller visibility and waits for the original SQL", async () => {
    await expect(resetAdminUserPassword("hidden", "123456", { role: "leader" })).rejects.toThrow("无权操作该用户"); expect(m.query).not.toHaveBeenCalled();
    m.query.mockResolvedValueOnce({ rows: [{ user_name: "alice" }] });
    expect(await resetAdminUserPassword("u", "123456", { role: "leader" })).toEqual({ id: "u", userName: "alice" });
    expect(m.query.mock.calls[1]).toEqual([expect.stringContaining("crypt($2, gen_salt('bf', 12))"), ["u", "123456", expect.any(Number)]]);
  });
  it("retains admin no-op and last-admin protections", async () => {
    expect(await setAdminUserAdmin("u", false)).toEqual({ id: "u", userName: "alice", isAdmin: 0 }); expect(m.admin).not.toHaveBeenCalled();
    m.profile.mockResolvedValue({ user_name: "admin", is_admin: true }); m.query.mockResolvedValue({ rows: [{ n: 1 }] });
    await expect(setAdminUserAdmin("u", false)).rejects.toThrow("至少保留一名管理员"); expect(m.admin).not.toHaveBeenCalled();
  });
  it("reloads after confirmed admin changes and not failed writes", async () => {
    m.admin.mockResolvedValueOnce(false); await expect(setAdminUserAdmin("u", true)).rejects.toThrow("更新管理员状态失败"); expect(m.reload).not.toHaveBeenCalled();
    expect(await setAdminUserAdmin("u", true)).toEqual({ id: "u", userName: "alice", isAdmin: 1 }); expect(m.reload).toHaveBeenCalledWith("u");
  });
  it("retains role, team, and self-change guards", async () => {
    await expect(setAdminUserRole("u", "admin", null, "u")).rejects.toThrow("不能更改当前登录账号的角色");
    await expect(setAdminUserRole("u", "leader")).rejects.toThrow("团队长必须分配");
    await expect(setAdminUserRole("u", "leader", "missing")).rejects.toThrow("团队「missing」不存在"); expect(m.role).not.toHaveBeenCalled();
  });
  it("keeps the last administrator when changing role", async () => {
    m.profile.mockResolvedValue({ user_name: "admin", role: "admin", is_admin: true }); m.query.mockResolvedValue({ rows: [{ n: 1 }] });
    await expect(setAdminUserRole("u", "user")).rejects.toThrow("至少保留一名管理员"); expect(m.role).not.toHaveBeenCalled();
  });
  it("keeps role then team then reload ordering", async () => {
    expect(await setAdminUserRole("u", "leader", "t1")).toEqual({ id: "u", userName: "alice", role: "leader", teamId: "t1", isAdmin: 0 });
    expect(m.role.mock.invocationCallOrder[0]).toBeLessThan(m.team.mock.invocationCallOrder[0]); expect(m.team.mock.invocationCallOrder[0]).toBeLessThan(m.reload.mock.invocationCallOrder[0]);
  });
  it("keeps occupied-team refusal and empty-team response", async () => {
    m.query.mockResolvedValueOnce({ rows: [{ n: 3 }] }).mockResolvedValueOnce({ rows: [{ n: 0 }] });
    await expect(deleteTeam("t1")).rejects.toThrow("团队内还有 3 个成员"); expect(m.deleteTeam).not.toHaveBeenCalled();
    expect(await deleteTeam("t1")).toEqual({ id: "t1" });
  });
  it("preserves storage errors instead of returning success", async () => {
    const error = new Error("injected SQL failure"); m.query.mockRejectedValue(error);
    for (const run of [() => createAdminUser("alice", "123456"), () => deleteAdminUser("u"), () => renameAdminUser("u", "new"), () => resetAdminUserPassword("u", "123456"), () => deleteTeam("t1")]) await expect(run()).rejects.toBe(error);
    expect(m.reload).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), tx: vi.fn(), release: vi.fn() }));
vi.mock("../../../db/rds/common.js", () => ({ getPgPool: () => ({ query: mocks.query, connect: async () => ({ query: mocks.tx, release: mocks.release }) }) }));
const original = process.env.JWT_SECRET;
process.env.JWT_SECRET = "login-transaction-test-secret-long-enough";
const { authSignIn, authSignOut, authSignOutBrowserSession } = await import("../../../db/rds/auth_store.js");
const { signJwt, JWT_SECRET } = await import("../../../db/rds/jwt.js");
if (original === undefined) delete process.env.JWT_SECRET;
else process.env.JWT_SECRET = original;
const user = { id: "153f91c6-ce36-4014-8f9b-3612bbe4c0d1", user_name: "river", password_hash: "$2a$12$hash", active_session_id: "old-login" };
function result(sql) {
  if (sql.includes("FROM users")) return { rows: [user], rowCount: 1 };
  if (sql.includes("SELECT user_name FROM profiles")) return { rows: [{ user_name: "river" }], rowCount: 1 };
  return { rows: [], rowCount: 1 };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockImplementation(async sql => result(sql));
  mocks.tx.mockImplementation(async sql => result(sql));
});
describe("atomic login and targeted logout", () => {
  it("rolls back Cookie logout when refresh revocation fails", async () => {
    mocks.tx.mockImplementation(async sql => {
      if (sql.includes("UPDATE auth_refresh_tokens")) throw new Error("outage");
      return result(sql);
    });
    expect(await authSignOutBrowserSession({ id: "bs", userId: user.id, jwtSessionId: "old-login" })).toEqual({ temporary: true });
    expect(mocks.tx.mock.calls.at(-1)[0]).toBe("ROLLBACK");
    expect(mocks.tx.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(false);
  });
  it("does not touch browser credentials after a logout epoch conflict", async () => {
    mocks.tx.mockImplementation(async sql => sql.includes("UPDATE users") ? { rowCount: 0 } : result(sql));
    expect(await authSignOutBrowserSession({ id: "bs", userId: user.id, jwtSessionId: "old-login" })).toEqual({ conflict: true });
    expect(mocks.tx.mock.calls.some(([sql]) => sql.includes("UPDATE auth_sessions"))).toBe(false);
  });
  it("commits profile, refresh, browser session, revocation and login epoch on one connection", async () => {
    const login = await authSignIn("river", "password", {}, { browserSession: true });
    expect(login.browserSession.token).toMatch(/^bs1\./);
    expect(login.refreshToken).toMatch(/^rt1\./);
    const sql = mocks.tx.mock.calls.map(([s]) => s);
    expect(sql[0]).toBe("BEGIN");
    expect(sql[1]).toContain("FOR UPDATE");
    expect(sql.at(-1)).toBe("COMMIT");
    for (const table of ["profiles", "auth_sessions", "auth_refresh_tokens", "users"])
      expect(sql.some(s => s.includes(table))).toBe(true);
    expect(mocks.query.mock.calls.filter(([s]) => /UPDATE|INSERT/.test(s) && !s.includes("auth_session_audit"))).toEqual([]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it.each([
    "INSERT INTO profiles", "SELECT user_name FROM profiles", "INSERT INTO auth_refresh_tokens",
    "UPDATE auth_sessions", "INSERT INTO auth_sessions", "UPDATE auth_refresh_tokens", "UPDATE users", "COMMIT",
  ])("rolls back without returning credentials when %s fails", async failure => {
    mocks.tx.mockImplementation(async sql => {
      if (sql.includes(failure)) throw new Error("injected database outage");
      return result(sql);
    });
    const login = await authSignIn("river", "password", {}, { browserSession: true });
    expect(login.error).toBe("db");
    expect(login.accessToken).toBeUndefined();
    expect(mocks.tx.mock.calls.at(-1)[0]).toBe("ROLLBACK");
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("does not revoke old credentials if profile validation fails", async () => {
    const login = await authSignIn("river", "password", {}, { browserSession: true, validateProfile: async () => {
      throw Object.assign(new Error("certificate mismatch"), { code: "CERT_BIND_FAILED" });
    } });
    expect(login.error).toBe("cert");
    expect(mocks.tx.mock.calls.some(([sql]) => sql.includes("UPDATE auth_sessions") || sql.includes("UPDATE users"))).toBe(false);
  });
  it("rechecks the old login epoch atomically when logout races with a new login", async () => {
    mocks.query.mockImplementation(async sql => sql.startsWith("SELECT") ? { rows: [{ sid: "old-login" }] } : { rowCount: 0 });
    await authSignOut(signJwt({ sub: user.id, typ: "access", session_id: "old-login" }, JWT_SECRET, 60));
    const update = mocks.query.mock.calls.find(([sql]) => sql.startsWith("UPDATE users"));
    expect(update[0]).toContain("metadata->>'active_session_id' = $2");
    expect(update[1][1]).toBe("old-login");
  });
});

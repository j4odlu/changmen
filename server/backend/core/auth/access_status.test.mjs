import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("../../../db/rds/common.js", () => ({ getPgPool: () => ({ query }) }));
const previous = process.env.JWT_SECRET;
process.env.JWT_SECRET = "access-status-test-secret-at-least-32";
const { JWT_SECRET, signJwt } = await import("../../../db/rds/jwt.js");
const { authGetUserStatus } = await import("../../../db/rds/auth_store.js");
afterAll(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
let sequence = 0;
function token(ttl = 60, secret = JWT_SECRET, extra = {}) {
  return signJwt({ sub: `u${++sequence}`, typ: "access", session_id: "current", ...extra }, secret, ttl);
}
beforeEach(() => { query.mockReset(); query.mockResolvedValue({ rows: [{ sid: "current" }] }); });
describe("access status", () => {
  it("classifies a signed expired JWT without authorizing it or querying DB", async () => {
    expect(await authGetUserStatus(token(-1))).toMatchObject({ code: "ACCESS_TOKEN_EXPIRED" });
    expect(query).not.toHaveBeenCalled();
  });
  it("does not trust an expired JWT signed by someone else", async () => {
    expect(await authGetUserStatus(token(-1, "wrong-key"))).toEqual({ code: "AUTH_REQUIRED" });
  });
  it("does not accept refresh tokens as access tokens", async () => {
    expect(await authGetUserStatus(token(60, JWT_SECRET, { typ: "refresh" }))).toEqual({ code: "AUTH_REQUIRED" });
  });
  it("preserves a temporary DB failure and recovers without caching failure", async () => {
    const access = token();
    query.mockRejectedValueOnce(new Error("connection timeout"));
    expect(await authGetUserStatus(access)).toMatchObject({ code: "TEMPORARY_UNAVAILABLE" });
    expect(await authGetUserStatus(access)).toHaveProperty("userId");
    expect(query).toHaveBeenCalledTimes(2);
  });
  it.each(["logged_out", "another-session"])("still rejects %s", async (sid) => {
    query.mockResolvedValue({ rows: [{ sid }] });
    expect(await authGetUserStatus(token())).toMatchObject({ code: "SESSION_REVOKED" });
  });
  it("accepts a valid session", async () => {
    const result = await authGetUserStatus(token());
    expect(result.userId).toBeTruthy();
    expect(result.code).toBeUndefined();
  });
});

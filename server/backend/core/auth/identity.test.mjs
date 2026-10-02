import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateIdentity } from "./identity.js";
const deps = { authResolveBrowserSession: vi.fn(), authGetUserStatus: vi.fn() };
const cookie = { id: "browser", userId: "u", jwtSessionId: "epoch" };
beforeEach(() => {
  vi.resetAllMocks();
  deps.authResolveBrowserSession.mockResolvedValue(cookie);
  deps.authGetUserStatus.mockResolvedValue({ userId: "u", loginEpoch: "epoch" });
});
describe("shared credential identity", () => {
  it("returns the same user and login epoch for Cookie and JWT", async () => {
    const web = await authenticateIdentity({ browserSessionToken: "cookie", protocol: "cookie" }, deps);
    const plugin = await authenticateIdentity({ token: "jwt" }, deps);
    expect(web).toMatchObject({ userId: "u", loginEpoch: "epoch", sessionId: "browser", credentialType: "cookie" });
    expect(plugin).toMatchObject({ userId: web.userId, loginEpoch: web.loginEpoch, credentialType: "token" });
  });
  it.each([{ userId: "other", loginEpoch: "epoch" }, { userId: "u", loginEpoch: "old" }])("rejects dual credential conflict %j", async jwt => {
    deps.authGetUserStatus.mockResolvedValue(jwt);
    expect(await authenticateIdentity({ token: "jwt", browserSessionToken: "cookie" }, deps)).toEqual({ code: "CREDENTIAL_CONFLICT" });
  });
  it("does not rescue an expired legacy JWT with Cookie", async () => {
    deps.authGetUserStatus.mockResolvedValue({ code: "ACCESS_TOKEN_EXPIRED" });
    expect(await authenticateIdentity({ token: "old", browserSessionToken: "cookie" }, deps)).toMatchObject({ code: "ACCESS_TOKEN_EXPIRED" });
  });
  it("does not fall back to JWT when Cookie is explicitly requested", async () => {
    deps.authResolveBrowserSession.mockResolvedValue({ revoked: true });
    expect(await authenticateIdentity({ protocol: "cookie", token: "jwt", browserSessionToken: "cookie" }, deps)).toEqual({ code: "SESSION_REVOKED" });
  });
  it("preserves a database outage even with another valid credential", async () => {
    deps.authResolveBrowserSession.mockResolvedValue({ temporary: true });
    expect(await authenticateIdentity({ token: "jwt", browserSessionToken: "cookie" }, deps)).toEqual({ code: "TEMPORARY_UNAVAILABLE" });
  });
  it("classifies thrown dependency failures as unavailable", async () => {
    deps.authGetUserStatus.mockRejectedValue(new Error("pool timeout"));
    expect(await authenticateIdentity({ token: "jwt" }, deps)).toEqual({ code: "TEMPORARY_UNAVAILABLE" });
  });
});

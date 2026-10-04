import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authenticateIdentity } from "./identity.js";
import { resolveRequestAuth } from "./request_auth.js";
import { login } from "./login_service.js";
const cookie = { userId: "u", id: "bs", jwtSessionId: "epoch" };
let deps;
beforeEach(() => {
  vi.stubEnv("AUTH_MODE", "cookie");
  deps = { authResolveBrowserSession: vi.fn().mockResolvedValue(cookie), authGetUserStatus: vi.fn(),
    getProfileById: vi.fn().mockReturnValue({ id: "u" }), loadProfileById: vi.fn() };
});
afterEach(() => vi.unstubAllEnvs());
it("authenticates Cookie identity directly without invoking JWT or refresh", async () => {
  const result = await resolveRequestAuth({ browserSessionToken: "opaque", action: "Client_GetMatchs" }, deps);
  expect(result).toMatchObject({ token: "", authMethod: "cookie", user: { id: "u" }, identity: { loginEpoch: "epoch" } });
  expect(deps.authGetUserStatus).not.toHaveBeenCalled();
});
it.each(["", "opaque"])("rejects JWT even when Cookie is %s, never rescuing stale credentials", async value => {
  expect(await authenticateIdentity({ token: "legacy", browserSessionToken: value }, deps)).toEqual({ code: "JWT_DISABLED" });
  expect(deps.authGetUserStatus).not.toHaveBeenCalled();
  expect(deps.authResolveBrowserSession).not.toHaveBeenCalled();
});
it("missing Cookie cannot authenticate or fall back", async () => {
  expect(await authenticateIdentity({}, deps)).toEqual({ code: "AUTH_REQUIRED" });
  expect(deps.authResolveBrowserSession).not.toHaveBeenCalled();
});
it.each(["Client_Login", "Client_RefreshToken", "Client_Logout"])("rejects retired action %s before credential validation", async action => {
  expect((await resolveRequestAuth({ action, token: "old", browserSessionToken: "opaque" }, deps)).failure.code).toBe("COOKIE_LOGIN_REQUIRED");
  expect(deps.authResolveBrowserSession).not.toHaveBeenCalled();
});
it("rejects response-less IPC login before password/database work", async () => {
  expect(await login({ userName: "u", password: "p" }, {})).toMatchObject({ success: 0, code: "COOKIE_LOGIN_REQUIRED" });
});
it("database unavailability is preserved, never classified as revocation", async () => {
  deps.authResolveBrowserSession.mockResolvedValue({ temporary: true });
  expect(await authenticateIdentity({ browserSessionToken: "opaque" }, deps)).toEqual({ code: "TEMPORARY_UNAVAILABLE" });
});

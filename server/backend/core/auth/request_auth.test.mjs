import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveRequestAuth, shouldAuditAccessFailure } from "./request_auth.js";

const input = { token: "access", browserSessionToken: "cookie", action: "Client_GetFootballMatches" };
const deps = {
  authBrowserSession: vi.fn(),
  authGetUserStatus: vi.fn(),
  getProfileById: vi.fn(),
  loadProfileById: vi.fn(),
};
beforeEach(() => {
  vi.resetAllMocks();
  deps.authGetUserStatus.mockResolvedValue({ userId: "u1" });
  deps.getProfileById.mockReturnValue({ id: "u1" });
});
describe("HTTP authentication before business dispatch", () => {
  it("bounds audit volume and does not attribute unverified tokens to a user", () => {
    expect(shouldAuditAccessFailure(undefined, "AUTH_REQUIRED", 1)).toBe(false);
    expect(shouldAuditAccessFailure("audit-user", "ACCESS_TOKEN_EXPIRED", 1)).toBe(true);
    expect(shouldAuditAccessFailure("audit-user", "ACCESS_TOKEN_EXPIRED", 2)).toBe(false);
    expect(shouldAuditAccessFailure("audit-user", "ACCESS_TOKEN_EXPIRED", 60_001)).toBe(true);
  });
  it.each(["ACCESS_TOKEN_EXPIRED", "SESSION_REVOKED", "AUTH_REQUIRED", "TEMPORARY_UNAVAILABLE"])("preserves %s instead of returning generic not logged in", async (code) => {
    deps.authGetUserStatus.mockResolvedValue({ code });
    const result = await resolveRequestAuth(input, deps);
    expect(result.failure).toMatchObject({ success: 0, code });
    expect(deps.loadProfileById).not.toHaveBeenCalled();
    expect(deps.authBrowserSession).not.toHaveBeenCalled();
  });
  it("does not interpret a profile database outage as a logout", async () => {
    deps.getProfileById.mockReturnValue(null);
    deps.loadProfileById.mockResolvedValue(null);
    expect((await resolveRequestAuth(input, deps)).failure.code).toBe("TEMPORARY_UNAVAILABLE");
  });
  it("preserves temporary cookie restoration errors", async () => {
    deps.authBrowserSession.mockResolvedValue({ temporary: true });
    expect((await resolveRequestAuth({ ...input, token: "" }, deps)).failure.code).toBe("TEMPORARY_UNAVAILABLE");
    expect(deps.authGetUserStatus).not.toHaveBeenCalled();
  });
  it("lets refresh classify its own cookie even if the access token has expired", async () => {
    expect(await resolveRequestAuth({ ...input, action: "Client_RefreshToken" }, deps)).toEqual({ token: "access", user: null });
    expect(deps.authGetUserStatus).not.toHaveBeenCalled();
  });
  it("restores a missing access token with the cookie", async () => {
    deps.authBrowserSession.mockResolvedValue({ accessToken: "restored" });
    expect(await resolveRequestAuth({ ...input, token: "" }, deps)).toMatchObject({ token: "restored", user: { id: "u1" } });
  });
  it("allows football and esports to share the same authenticated identity", async () => {
    const [football, esports] = await Promise.all([
      resolveRequestAuth(input, deps),
      resolveRequestAuth({ ...input, action: "Client_GetMatchs" }, deps),
    ]);
    expect(football.user).toEqual(esports.user);
    expect(football.failure).toBeUndefined();
    expect(esports.failure).toBeUndefined();
  });
});

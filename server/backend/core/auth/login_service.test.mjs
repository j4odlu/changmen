import { beforeEach, expect, it, vi } from "vitest";
const rate = vi.hoisted(() => ({ limited: false }));
vi.mock("./login_rate_limit.js", () => ({ checkLoginRateLimit: () => rate, recordLoginFailure: vi.fn(), recordLoginSuccess: vi.fn() }));
vi.mock("../shared/client_cert_gate.js", () => ({ certLoginBindError: () => null, clientCertCnFromSubject: () => "river" }));
vi.mock("./browser_session.js", () => ({ browserSessionEnabled: () => true, setBrowserSessionCookie: (res, token) => res.setHeader("Set-Cookie", token) }));
import { login } from "./login_service.js";
const profile = { id: "user", userName: "river" };
let deps;
beforeEach(() => {
  rate.limited = false;
  deps = {
    db: { isAuthConfigured: () => true, recordAuthAudit: vi.fn(), insertProfile: vi.fn().mockResolvedValue(true),
      authSignIn: vi.fn(async (_name, _password, _audit, options) => {
        await options.validateProfile(profile);
        return { userId: "user", email: "river@example.test", accessToken: "jwt", browserAccessToken: "browser-jwt", refreshToken: "refresh",
          ...(options.browserSession ? { browserSession: { token: "opaque-cookie", absoluteExpiresAt: Date.now() + 60000 } } : {}) };
      }) },
    loadProfileById: vi.fn().mockResolvedValue(profile), assertProfileActive: vi.fn(), touchUserPresence: vi.fn(), recordUserLastLogin: vi.fn(),
  };
});
it("preserves legacy login envelope and profile/presence hooks without a response object", async () => {
  const result = await login({ username: "river", password: "password" }, deps, "127.0.0.1");
  expect(result).toEqual({ success: 1, msg: "ok", info: { token: "jwt", refreshToken: "refresh", sessionMode: "legacy", userName: "river", ID: "user" } });
  expect(deps.assertProfileActive).toHaveBeenCalledWith("user");
  expect(deps.touchUserPresence).toHaveBeenCalledWith("user");
  expect(deps.recordUserLastLogin).toHaveBeenCalledWith("user", "127.0.0.1");
});
it("sets committed Cookie before hydrating the profile and preserves the existing Client_Login envelope", async () => {
  const response = { setHeader: vi.fn() };
  deps.loadProfileById.mockImplementation(async () => {
    expect(response.setHeader).toHaveBeenCalledWith("Set-Cookie", "opaque-cookie");
    return profile;
  });
  const result = await login({ userName: "river", password: "password" }, deps, "", null, "", response);
  expect(result.info).toEqual({ token: "browser-jwt", sessionMode: "cookie", userName: "river", ID: "user" });
});
it("reports uncertainty after commit when profile loading and fallback do not provide a profile", async () => {
  deps.loadProfileById.mockResolvedValue(null);
  const response = { setHeader: vi.fn() };
  expect(await login({ userName: "river", password: "password" }, deps, "", null, "", response)).toMatchObject({ success: 0, code: "LOGIN_RESULT_UNCERTAIN" });
  expect(response.setHeader).toHaveBeenCalledOnce();
  expect(deps.db.authSignIn).toHaveBeenCalledOnce();
  expect(deps.db.insertProfile).toHaveBeenCalledOnce();
  expect(deps.touchUserPresence).not.toHaveBeenCalled();
});
it("rejects invalid input and rate limited login before the database transaction", async () => {
  expect(await login({}, deps)).toMatchObject({ success: 0 });
  rate.limited = true;
  expect(await login({ userName: "river", password: "password" }, deps)).toMatchObject({ code: "RATE_LIMITED" });
  expect(deps.db.authSignIn).not.toHaveBeenCalled();
});
it("does not create a Cookie or start user activity on transaction failure", async () => {
  deps.db.authSignIn.mockResolvedValue({ error: "db" });
  const response = { setHeader: vi.fn() };
  expect(await login({ userName: "river", password: "password" }, deps, "", null, "", response)).toMatchObject({ code: "TEMPORARY_UNAVAILABLE" });
  expect(response.setHeader).not.toHaveBeenCalled();
  expect(deps.loadProfileById).not.toHaveBeenCalled();
  expect(deps.touchUserPresence).not.toHaveBeenCalled();
});

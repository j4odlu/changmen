import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireHttpUser, readAccessToken } from "./http_identity.js";
import { sessionCsrf } from "./web_session_security.js";
const saved = { ...process.env };
const session = { id: "browser", userId: "u", jwtSessionId: "epoch" };
const deps = { authResolveBrowserSession: vi.fn(), authGetUserStatus: vi.fn(), getProfileById: () => ({ id: "u" }), loadProfileById: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  process.env.NODE_ENV = "test";
  process.env.AUTH_MODE = "dual";
  process.env.WEB_AUTH_ORIGINS = "https://changmen.fun";
  process.env.WEB_AUTH_CSRF_SECRET = "separate-http-test-csrf-secret-long-enough";
  deps.authResolveBrowserSession.mockResolvedValue(session);
  deps.authGetUserStatus.mockResolvedValue({ userId: "u", loginEpoch: "epoch" });
});
afterEach(() => { process.env = { ...saved }; });
function req(method = "POST") { return { method, headers: { origin: "https://changmen.fun", cookie: "cm_session=secret", "x-changmen-auth": "cookie" } }; }
describe("HTTP credential adapter", () => {
  it("normalizes SDK Bearer and legacy token headers", () => {
    expect(readAccessToken({ headers: { authorization: "Bearer jwt" } })).toBe("jwt");
    expect(readAccessToken({ headers: { token: "jwt" } })).toBe("jwt");
  });
  it("allows Cookie reads but requires CSRF for writes", async () => {
    expect(await requireHttpUser(req("GET"), {}, deps)).toHaveProperty("user.id", "u");
    expect(await requireHttpUser(req(), {}, deps)).toHaveProperty("error.status", 403);
    const request = req(); request.headers["x-csrf-token"] = sessionCsrf(session);
    expect(await requireHttpUser(request, {}, deps)).toHaveProperty("user.id", "u");
  });
  it("requires CSRF even for relay GET requests when requested", async () => {
    expect(await requireHttpUser(req("GET"), { alwaysCsrf: true }, deps)).toHaveProperty("error.status", 403);
  });
  it("preserves old SDK token requests without Cookie or Origin", async () => {
    expect(await requireHttpUser({ method: "POST", headers: { authorization: "Bearer jwt" } }, {}, deps)).toHaveProperty("user.id", "u");
  });
  it("reports database exceptions and explicit outages as 503", async () => {
    deps.authResolveBrowserSession.mockRejectedValue(new Error("pool unavailable"));
    expect(await requireHttpUser(req(), {}, deps)).toHaveProperty("error.status", 503);
    deps.authResolveBrowserSession.mockResolvedValue({ temporary: true });
    expect(await requireHttpUser(req(), {}, deps)).toHaveProperty("error.status", 503);
  });
});

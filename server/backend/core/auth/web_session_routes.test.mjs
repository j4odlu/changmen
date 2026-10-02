import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), login: vi.fn(), signOut: vi.fn(), revoke: vi.fn() }));
vi.mock("@changmen/db", () => ({
  authResolveBrowserSession: mocks.resolve,
  authSignOutBrowserSession: mocks.signOut,
}));
vi.mock("../db/store.js", () => ({ loadProfileById: async () => ({ id: "u", userName: "river", role: "user" }) }));
vi.mock("../esport-api/router.js", () => ({ handleClientLogin: mocks.login }));
const { tryWebSessionRoutes } = await import("./web_session_routes.js");
const { sessionCsrf } = await import("./web_session_security.js");
const saved = { ...process.env };
const session = { userId: "u", id: "browser", jwtSessionId: "epoch" };
let server, base;
beforeEach(async () => {
  vi.clearAllMocks();
  process.env.NODE_ENV = "test";
  process.env.WEB_AUTH_ORIGINS = "https://changmen.fun";
  process.env.WEB_AUTH_CSRF_SECRET = "separate-csrf-key-32-bytes-long-enough";
  mocks.resolve.mockResolvedValue(session);
  mocks.revoke.mockResolvedValue(true);
  mocks.signOut.mockResolvedValue({ ok: true });

  server = http.createServer(async (req, res) => {
    try { if (!await tryWebSessionRoutes(req, res)) { res.writeHead(404); res.end(); } }
    catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { process.env = { ...saved }; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
async function request(path, body, csrf = sessionCsrf(session)) {
  return fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { cookie: "cm_session=opaque-cookie", origin: "https://changmen.fun", "content-type": "application/json", "x-csrf-token": csrf },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
describe("real HTTP Cookie protocol", () => {
  it("exposes identity but neither JWT nor Cookie secret", async () => {
    const res = await request("/auth/session");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    const data = await res.json();
    expect(data.browserSessionId).toBe("browser");
    expect(JSON.stringify(data)).not.toContain("opaque-cookie");
    expect(data.accessToken).toBeUndefined();
  });
  it("does not expose access or refresh JWT on native Cookie login", async () => {
    process.env.WEB_AUTH_COOKIE_ENABLED = "1";
    mocks.login.mockResolvedValue({ success: 1, info: { token: "jwt-secret", refreshToken: "refresh-secret", ID: "u", userName: "river", sessionMode: "cookie" } });
    const res = await fetch(base + "/auth/login", { method: "POST", headers: { origin: "https://changmen.fun", "x-changmen-auth": "cookie", "content-type": "application/json" }, body: JSON.stringify({ userName: "river", password: "password" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.info).toEqual({ ID: "u", userName: "river", sessionMode: "cookie" });
  });
  it("cannot revoke a new session with an old logout expectation", async () => {
    const res = await request("/auth/logout", { expectedBrowserSessionId: "old-browser", expectedLoginEpoch: "old-epoch" });
    expect(res.status).toBe(409);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("logs out only the submitted session without a Cookie-delete response", async () => {
    const res = await request("/auth/logout", { expectedBrowserSessionId: "browser", expectedLoginEpoch: "epoch" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(mocks.signOut).toHaveBeenCalledWith(session, expect.any(Object));
  });
  it("rejects missing CSRF before logout", async () => {
    const res = await request("/auth/logout", { expectedBrowserSessionId: "browser", expectedLoginEpoch: "epoch" }, "");
    expect(res.status).toBe(403);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("has no capability or session-mode endpoints", async () => {
    for (const path of ["/auth/capabilities", "/auth/session/mode"])
      expect((await request(path)).status).toBe(404);
  });
  it("reports an outage as 503 without deleting the browser credential", async () => {
    mocks.resolve.mockResolvedValue({ temporary: true });
    const res = await request("/auth/session");
    expect(res.status).toBe(503);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

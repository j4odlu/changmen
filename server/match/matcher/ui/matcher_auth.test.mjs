import { afterEach, expect, it, vi } from "vitest";
import { configureMatcherRuntime } from "../runtime_ports.js";
import { createMatcherAuthMiddleware, resolveMatcherUser } from "./matcher_auth.js";
afterEach(() => { configureMatcherRuntime(); vi.unstubAllEnvs(); });
it("rejects access when no host auth was installed", async () => {
  vi.stubEnv("MATCHER_SKIP_AUTH", "0");
  await expect(resolveMatcherUser({ headers: {} })).rejects.toThrow("not configured");
});
it("delegates user, permissions and CSRF to host without dropping session checks", async () => {
  vi.stubEnv("MATCHER_SKIP_AUTH", "0");
  const next = vi.fn(); const req = { path: "/api/end", method: "POST", headers: {} };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  const session = { id: "s" };
  const csrf = vi.fn().mockReturnValue(false);
  configureMatcherRuntime({ auth: {
    resolveMatcherUser: async () => ({ user: { role: "admin" }, session }),
    canAccessMatcherUi: () => true, validSessionCsrf: csrf,
  } });
  await createMatcherAuthMiddleware()(req, res, next);
  expect(csrf).toHaveBeenCalledWith(req, session);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.json).toHaveBeenCalledWith({ ok: false, error: "CSRF_INVALID" });
  expect(next).not.toHaveBeenCalled();
});
it.each([
  [{ user: null }, true, 401],
  [{ user: null, temporary: true }, true, 503],
  [{ user: { role: "user" } }, false, 403],
  [{ user: { role: "admin" } }, true, null],
])("preserves host authentication result %j", async (resolved, permitted, status) => {
  vi.stubEnv("MATCHER_SKIP_AUTH", "0");
  const next = vi.fn(); const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  configureMatcherRuntime({ auth: { resolveMatcherUser: async () => resolved,
    canAccessMatcherUi: () => permitted, validSessionCsrf: () => true } });
  await createMatcherAuthMiddleware()({ path: "/api/debug", method: "GET", headers: {} }, res, next);
  if (status) { expect(res.status).toHaveBeenCalledWith(status); expect(next).not.toHaveBeenCalled(); }
  else expect(next).toHaveBeenCalledOnce();
});

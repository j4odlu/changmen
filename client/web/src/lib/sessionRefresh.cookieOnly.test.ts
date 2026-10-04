import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ probe: vi.fn(), watch: vi.fn(), stop: vi.fn(), jwt: vi.fn(), startJwt: vi.fn() }));
vi.mock("@/api/client", () => ({ getRefreshToken: () => "legacy-refresh", isCookieAuthMode: () => true, usesWebCookieSession: () => false }));
vi.mock("@/lib/webSession", () => ({ probeCookieSession: mocks.probe, startWebSessionWatch: mocks.watch, stopWebSessionWatch: mocks.stop }));
vi.mock("@/lib/jwtRefresh", () => ({ refreshJwtSession: mocks.jwt, startJwtAutoRefresh: mocks.startJwt }));
import { ensureTokenRefresh, startTokenRefresh } from "./sessionRefresh";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("VITE_WEB_COOKIE_AUTH", "1"); });
afterEach(() => vi.unstubAllEnvs());
it("missing Cookie never falls back to legacy JWT refresh", async () => {
  mocks.probe.mockResolvedValue(false);
  await ensureTokenRefresh();
  await startTokenRefresh();
  expect(mocks.probe).toHaveBeenCalledWith(true, true);
  expect(mocks.jwt).not.toHaveBeenCalled();
  expect(mocks.startJwt).not.toHaveBeenCalled();
});
it("an unavailable Cookie service preserves the error without changing authentication", async () => {
  mocks.probe.mockRejectedValue(new Error("unavailable"));
  await expect(ensureTokenRefresh()).rejects.toThrow("unavailable");
  expect(mocks.jwt).not.toHaveBeenCalled();
});

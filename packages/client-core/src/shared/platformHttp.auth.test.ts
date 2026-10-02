import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformAccount } from "../models/platformAccount";
const mocks = vi.hoisted(() => { vi.resetModules(); return { request: vi.fn(), post: vi.fn(), auth: vi.fn() }; });
vi.mock("./a8Axios", () => ({ a8Axios: { request: mocks.request, post: mocks.post }, responseBodyText: (data: unknown) => String(data) }));
import { accountHttpRequest, changmenPmEsportCall, registerPlatformHttpContext, clearPlatformHttpContext } from "./platformHttp";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.request.mockResolvedValue({ status: 200, data: "ok", headers: {} });
  mocks.post.mockResolvedValue({ status: 200, data: { success: 1, info: "result" } });
  mocks.auth.mockResolvedValue({ "X-Changmen-Auth": "cookie", "X-CSRF-Token": "csrf" });
  registerPlatformHttpContext({ getToken: () => null, getAuthHeaders: mocks.auth, getApiBase: () => "https://api.changmen.fun", getProxyUrl: () => undefined });
});
afterEach(clearPlatformHttpContext);
describe("platform request credential bridge", () => {
  it("supports Cookie credentials for PM actions without a JWT", async () => {
    expect(await changmenPmEsportCall("Pm_Test", {})).toBe("result");
    expect(mocks.post.mock.calls[0]?.[2]).toMatchObject({ withCredentials: true, headers: { "X-Changmen-Auth": "cookie", "X-CSRF-Token": "csrf" } });
  });
  it("does not expose backend credentials to direct venue requests", async () => {
    await accountHttpRequest({ proxyId: 0 } as PlatformAccount, "https://venue.example", {});
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.request.mock.calls[0]?.[0]).toMatchObject({ withCredentials: false, headers: {} });
  });
  it("adds backend Cookie credentials only when using the configured relay", async () => {
    await accountHttpRequest({ proxyId: 1 } as PlatformAccount, "https://venue.example", {});
    expect(mocks.auth).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0]?.[0]).toMatchObject({ withCredentials: true, headers: { "X-Changmen-Auth": "cookie", "X-CSRF-Token": "csrf", "x-proxy-url": "https://venue.example" } });
  });
});

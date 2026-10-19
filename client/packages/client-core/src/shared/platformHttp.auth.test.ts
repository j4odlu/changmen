import type { PlatformAccount } from "../models/platformAccount";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountHttpRequest, changmenPmEsportCall, changmenPmHttpRequest, clearPlatformHttpContext, registerPlatformHttpContext } from "./platformHttp";

const mocks = vi.hoisted(() => { vi.resetModules(); return { request: vi.fn(), post: vi.fn(), auth: vi.fn() }; });
vi.mock("./a8Axios", () => ({ a8Axios: { request: mocks.request, post: mocks.post }, responseBodyText: (data: unknown) => String(data) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.request.mockResolvedValue({ status: 200, data: "ok", headers: {} });
  mocks.post.mockResolvedValue({ status: 200, data: { success: 1, info: "result" } });
  mocks.auth.mockResolvedValue({ "X-Changmen-Auth": "cookie", "X-CSRF-Token": "csrf" });
  registerPlatformHttpContext({ getToken: () => null, getAuthHeaders: mocks.auth, getApiBase: () => "https://api.changmen.fun", getProxyUrl: () => undefined });
});
afterEach(clearPlatformHttpContext);
describe("platform request credential bridge", () => {
  it.each([404, 401, 429, 503])("preserves PM private-read upstream status %s", async (status) => {
    mocks.post.mockResolvedValue({ data: { success: 0, msg: "upstream failed", upstreamStatus: status } });
    await expect(changmenPmEsportCall("Pm_GetOrder", {})).rejects.toMatchObject({ status, message: "upstream failed" });
  });
  it("does not mistake gateway errors or submit errors for an upstream order 404", async () => {
    mocks.post.mockRejectedValueOnce({ response: { status: 404 } });
    await expect(changmenPmEsportCall("Pm_GetOrder", {})).rejects.not.toHaveProperty("status");
    mocks.post.mockResolvedValue({ data: { success: 0, msg: "submit failed", upstreamStatus: 404 } });
    await expect(changmenPmEsportCall("Pm_SubmitOrder", {})).rejects.not.toHaveProperty("status");
  });
  it("preserves upstream PM error status, body and Retry-After through the VPS wrapper", async () => {
    const data = { code: "rate_limited", error: "busy", retryable: true, trace_id: "trace" };
    mocks.post.mockResolvedValue({ data: { success: 1, info: {
      status: 429,
      text: JSON.stringify(data),
      headers: { "retry-after": "2" },
    } } });
    await expect(changmenPmHttpRequest({ url: "https://data-api.polymarket.com/v2/activity" })).rejects.toMatchObject({
      response: { status: 429, headers: { "retry-after": "2" }, data },
    });
  });
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

import { afterEach, expect, it, vi } from "vitest";
import { SessionBuilderConfig } from "./sessionBuilderConfig";

afterEach(() => vi.unstubAllGlobals());
it("signs through Cookie/CSRF without requesting or sending a legacy JWT", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ POLY_BUILDER_SIGNATURE: "signature" }) });
  vi.stubGlobal("fetch", fetch);
  const token = vi.fn();
  const auth = vi.fn().mockResolvedValue({ "X-Changmen-Auth": "cookie", "X-CSRF-Token": "csrf" });
  const builder = new SessionBuilderConfig("https://api.changmen.fun/api/polymarket/relayer/sign", token, auth);
  await builder.generateBuilderHeaders("POST", "/submit", "{}");
  expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "include", headers: { "X-Changmen-Auth": "cookie", "X-CSRF-Token": "csrf" } });
  expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  expect(token).not.toHaveBeenCalled();
  auth.mockRejectedValueOnce(new Error("登录状态已变更"));
  await expect(builder.generateBuilderHeaders("POST", "/submit", "{}")).rejects.toThrow("登录状态已变更");
  expect(fetch).toHaveBeenCalledOnce();
});
it("obtains credentials for every signing call and stops before sending after the login changes", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ POLY_BUILDER_SIGNATURE: "signature" }) });
  vi.stubGlobal("fetch", fetch);
  const token = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("renewed").mockRejectedValueOnce(new Error("登录状态已变更"));
  const builder = new SessionBuilderConfig("https://sign.example/api/sign", token);
  await builder.generateBuilderHeaders("POST", "/submit", "{}");
  await builder.generateBuilderHeaders("POST", "/submit", "{}");
  expect(fetch.mock.calls.map(call => call[1].headers.Authorization)).toEqual(["Bearer first", "Bearer renewed"]);
  expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: "omit" });
  await expect(builder.generateBuilderHeaders("POST", "/submit", "{}")).rejects.toThrow("登录状态已变更");
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("fails signing admission on 401 without retrying or sending an unsigned request", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
  vi.stubGlobal("fetch", fetch);
  const builder = new SessionBuilderConfig("https://sign.example/api/sign", async () => "expired");
  await expect(builder.generateBuilderHeaders("POST", "/submit")).rejects.toThrow("401");
  expect(fetch).toHaveBeenCalledTimes(1);
});

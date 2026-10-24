import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { requireHttpUser } = vi.hoisted(() => ({ requireHttpUser: vi.fn() }));
vi.mock("../../auth/http_identity.js", () => ({ requireHttpUser }));
import { handlePolymarketClobL1ApiCreds } from "./clob_l1_http.js";

describe("retired Polymarket server L1 endpoint", () => {
  let readJsonBody;
  let fetch;
  beforeEach(() => {
    requireHttpUser.mockReset().mockResolvedValue({ user: { id: 1 } });
    readJsonBody = vi.fn(() => { throw new Error("request body must not be read"); });
    fetch = vi.fn(() => { throw new Error("upstream must not be called"); });
    vi.stubGlobal("fetch", fetch);
  });
  afterEach(() => {
    expect(readJsonBody).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  async function call(method) {
    const req = { method, get body() { throw new Error("request body must not be accessed"); } };
    const res = { writeHead: vi.fn(), end: vi.fn() };
    expect(await handlePolymarketClobL1ApiCreds(req, res, readJsonBody)).toBe(true);
    return res;
  }

  test("keeps the authenticated POST 410 response without reading private keys", async () => {
    const res = await call("POST");
    expect(requireHttpUser).toHaveBeenCalledOnce();
    expect(res.writeHead).toHaveBeenCalledExactlyOnceWith(410, { "Content-Type": "application/json; charset=utf-8" });
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({
      error: "已废弃：请在浏览器内派生 Polymarket apiCreds，勿将 privateKey 提交到服务端",
    });
  });

  test("preserves authentication rejection before 410", async () => {
    const body = { error: "unauthorized" };
    requireHttpUser.mockResolvedValueOnce({ error: { status: 401, body } });
    const res = await call("POST");
    expect(res.writeHead).toHaveBeenCalledExactlyOnceWith(401, { "Content-Type": "application/json; charset=utf-8" });
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual(body);
  });

  test.each(["GET", "PUT", "DELETE"])("preserves 405 before authentication for %s", async method => {
    const res = await call(method);
    expect(requireHttpUser).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledExactlyOnceWith(405, { "Content-Type": "application/json; charset=utf-8" });
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ error: "method not allowed" });
  });
});

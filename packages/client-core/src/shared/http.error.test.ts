import { afterEach, expect, it, vi } from "vitest";
import { a8Axios } from "./a8Axios";
import { directGet, directPostJson } from "./http";

afterEach(() => vi.restoreAllMocks());

it("preserves HTTP error status and Retry-After on direct GET", async () => {
  const data = { code: "rate_limited", error: "busy", retryable: true };
  vi.spyOn(a8Axios, "get").mockResolvedValue({ status: 429, headers: { "retry-after": "2" }, data });
  await expect(directGet("https://data-api.polymarket.com/v2/activity", {})).rejects.toMatchObject({
    response: { status: 429, headers: { "retry-after": "2" }, data },
  });
});

it("POST keeps its default timeout unless explicitly overridden", async () => {
  const post = vi.spyOn(a8Axios, "post").mockResolvedValue({ status: 200, data: { ok: true } });
  await directPostJson("https://example.test", {}, {});
  expect(post.mock.calls[0][2]).not.toHaveProperty("timeout");
  await directPostJson("https://clob.polymarket.com/order", {}, {}, { timeout: 30_000 });
  expect(post.mock.calls[1][2]).toMatchObject({ timeout: 30_000 });
});

it("preserves POST business error metadata even when its message says Network Error", async () => {
  const data = { error: "Network Error at upstream" };
  vi.spyOn(a8Axios, "post").mockResolvedValue({ status: 400, headers: {}, data });
  await expect(directPostJson("https://clob.polymarket.com/order", {}, {})).rejects.toMatchObject({
    response: { status: 400, data },
  });
});

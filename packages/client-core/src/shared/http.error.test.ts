import { afterEach, expect, it, vi } from "vitest";
import { a8Axios } from "./a8Axios";
import { directGet } from "./http";

afterEach(() => vi.restoreAllMocks());

it("preserves HTTP error status and Retry-After on direct GET", async () => {
  const data = { code: "rate_limited", error: "busy", retryable: true };
  vi.spyOn(a8Axios, "get").mockResolvedValue({ status: 429, headers: { "retry-after": "2" }, data });
  await expect(directGet("https://data-api.polymarket.com/v2/activity", {})).rejects.toMatchObject({
    response: { status: 429, headers: { "retry-after": "2" }, data },
  });
});

import { afterEach, expect, it, vi } from "vitest";
import { remoteBuilderSigning } from "@polymarket/client";
import { signPolymarketRelayerRequest } from "./relayer_sign.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("official SDK accepts backend HMAC headers and sends Cookie/CSRF only to the application signer", async () => {
  vi.stubEnv("RELAYER_API_KEY", "");
  vi.stubEnv("RELAYER_API_KEY_ADDRESS", "");
  vi.stubEnv("POLYMARKET_RELAYER_AUTH", "builder_hmac");
  vi.stubEnv("POLYMARKET_RELAYER_SIGN_SDK", "unified");
  vi.stubEnv("POLY_BUILDER_API_KEY", "test-key");
  vi.stubEnv("POLY_BUILDER_SECRET", "dGVzdC1zZWNyZXQ=");
  vi.stubEnv("POLY_BUILDER_PASSPHRASE", "test-pass");
  const fetch = vi.fn(async (_url, options) => {
    const result = await signPolymarketRelayerRequest(JSON.parse(options.body));
    expect(result.ok).toBe(true);
    return Response.json(result.headers);
  });
  vi.stubGlobal("fetch", fetch);
  const signer = remoteBuilderSigning({
    url: "https://api.changmen.fun/api/polymarket/relayer/sign",
    credentials: "include",
    headers: async () => ({ "X-Changmen-Auth": "cookie", "X-CSRF-Token": "test-csrf" }),
  });
  const request = { method: "POST", path: "/submit", body: '{"nonce":"1"}' };
  const signed = new Headers(await signer.authorize(request));
  expect(fetch).toHaveBeenCalledOnce();
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe("https://api.changmen.fun/api/polymarket/relayer/sign");
  expect(options.credentials).toBe("include");
  expect(options.headers.get("X-CSRF-Token")).toBe("test-csrf");
  expect(JSON.parse(options.body)).toEqual(request);
  expect(signed.get("POLY_BUILDER_API_KEY")).toBe("test-key");
  expect(signed.get("POLY_BUILDER_SIGNATURE")).toBeTruthy();
  expect(signed.get("X-CSRF-Token")).toBeNull();
  expect(signed.get("X-Changmen-Auth")).toBeNull();
});

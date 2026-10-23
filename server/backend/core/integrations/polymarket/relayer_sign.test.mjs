import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import fixtures from "./builder_hmac.fixtures.json" with { type: "json" };
import { vi } from "vitest";
import { createPolymarketBuilderHeaders } from "./relayer_sign_unified.js";
import {
  getPolymarketRelayerPublicStatus,
  resolvePolymarketRelayerSignSdk,
  signPolymarketRelayerRequest,
} from "./relayer_sign.js";

const ENV_KEYS = [
  "RELAYER_API_KEY",
  "RELAYER_API_KEY_ADDRESS",
  "POLY_BUILDER_API_KEY",
  "POLY_BUILDER_SECRET",
  "POLY_BUILDER_PASSPHRASE",
  "POLYMARKET_RELAYER_SIGN_SDK",
];

function clearRelayerEnv() {
  for (const key of ENV_KEYS)
    delete process.env[key];
}

afterEach(() => {
  clearRelayerEnv();
  vi.useRealTimers();
});

it("signPolymarketRelayerRequest fails when creds missing", async () => {
  clearRelayerEnv();
  const r = await signPolymarketRelayerRequest({ method: "POST", path: "/submit" });
  assert.equal(r.ok, false);
  assert.match(r.msg, /未配置/);
});

it("signPolymarketRelayerRequest returns RELAYER_API_KEY headers (preferred)", async () => {
  process.env.RELAYER_API_KEY = "01967c03-b8c8-7000-8f68-8b8eaec6fd3d";
  process.env.RELAYER_API_KEY_ADDRESS = "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5";
  const r = await signPolymarketRelayerRequest({ method: "POST", path: "/submit" });
  assert.equal(r.ok, true);
  assert.equal(r.headers.RELAYER_API_KEY, "01967c03-b8c8-7000-8f68-8b8eaec6fd3d");
  assert.equal(r.headers.RELAYER_API_KEY_ADDRESS, "0x8ed24e533d24c2f381983eda8f97c2358f8d65e5");
  assert.equal(r.headers.POLY_BUILDER_API_KEY, undefined);
});

it("signPolymarketRelayerRequest returns POLY_BUILDER_* when no relayer key", async () => {
  process.env.POLY_BUILDER_API_KEY = "test-key";
  process.env.POLY_BUILDER_SECRET = "dGVzdC1zZWNyZXQ=";
  process.env.POLY_BUILDER_PASSPHRASE = "test-pass";
  const r = await signPolymarketRelayerRequest({
    method: "POST",
    path: "/submit",
    body: "{\"foo\":1}",
    timestamp: 1_700_000_000,
  });
  assert.equal(r.ok, true);
  assert.equal(r.headers.POLY_BUILDER_API_KEY, "test-key");
  assert.equal(r.headers.POLY_BUILDER_PASSPHRASE, "test-pass");
  assert.equal(r.headers.POLY_BUILDER_TIMESTAMP, "1700000000");
  assert.match(r.headers.POLY_BUILDER_SIGNATURE, /^[A-Za-z0-9_=-]+$/);
});

for (const [index, row] of fixtures.cases.entries()) it(`ESM signing preserves captured SDK headers #${index}`, async () => {
  clearRelayerEnv();
  process.env.POLY_BUILDER_API_KEY = fixtures.creds.key;
  process.env.POLY_BUILDER_SECRET = fixtures.creds.secret;
  process.env.POLY_BUILDER_PASSPHRASE = fixtures.creds.passphrase;
  assert.deepEqual(await createPolymarketBuilderHeaders(fixtures.creds, row.method, row.path, row.body, row.timestamp), row.headers);
  assert.deepEqual(await signPolymarketRelayerRequest(row), { ok: true, headers: row.headers });
});

it("retired selectors cannot restore the old SDK; invalid timestamps retain the current-time fallback", async () => {
  clearRelayerEnv();
  process.env.POLY_BUILDER_API_KEY = fixtures.creds.key;
  process.env.POLY_BUILDER_SECRET = fixtures.creds.secret;
  process.env.POLY_BUILDER_PASSPHRASE = fixtures.creds.passphrase;
  process.env.POLYMARKET_RELAYER_SIGN_SDK = "legacy";
  vi.useFakeTimers(); vi.setSystemTime(new Date(1700000000000));
  assert.equal(resolvePolymarketRelayerSignSdk(), "unified");
  const expected = await signPolymarketRelayerRequest({ method: "POST", path: "/submit" });
  for (const timestamp of ["invalid", Infinity, NaN, null])
    assert.deepEqual(await signPolymarketRelayerRequest({ method: "POST", path: "/submit", timestamp }), expected);
});

it("getPolymarketRelayerPublicStatus reflects env", () => {
  clearRelayerEnv();
  assert.equal(getPolymarketRelayerPublicStatus().configured, false);
  process.env.RELAYER_API_KEY = "k";
  process.env.RELAYER_API_KEY_ADDRESS = "0x0000000000000000000000000000000000000001";
  const s = getPolymarketRelayerPublicStatus();
  assert.equal(s.configured, true);
  assert.equal(s.authMode, "relayer_api_key");
  assert.equal(s.signSdk, "unified");
});

it("prefers builder_hmac when both relayer key and builder creds exist", () => {
  process.env.RELAYER_API_KEY = "relayer-k";
  process.env.RELAYER_API_KEY_ADDRESS = "0x0000000000000000000000000000000000000001";
  process.env.POLY_BUILDER_API_KEY = "builder-k";
  process.env.POLY_BUILDER_SECRET = "s";
  process.env.POLY_BUILDER_PASSPHRASE = "p";
  assert.equal(getPolymarketRelayerPublicStatus().authMode, "builder_hmac");
});

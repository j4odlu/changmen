import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

// Only the dedicated fixture service. Never infer a production target from .env.
const base = "http://127.0.0.1:4930";
const origin = "http://127.0.0.1:4931";
const checks = [];
const credentials = { userName: "river", password: "Acceptance-Only-2026!" };
async function json(path, headers, body) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin, "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, body: await response.json(), response };
}
const native = await json("/auth/login", { "x-changmen-auth": "cookie" }, credentials);
assert.equal(native.status, 200);
assert.equal(native.body.success, 1);
assert.equal(native.body.info.token, undefined);
const cookie = native.response.headers.get("set-cookie").split(";")[0];
const session = (await json("/auth/session", { cookie })).body;
assert.equal(session.user.userName, "river");
const web = { cookie, "x-changmen-auth": "cookie", "x-csrf-token": session.csrfToken };
checks.push("native-login-without-jwt");

async function business(headers, label) {
  const call = async (action, body = {}) => (await json("/esport/" + action, headers, body)).body;
  const matches = await call("Client_GetMatchs");
  assert.equal(matches.success, 1);
  assert.equal(matches.info.length, 1);
  assert.equal(matches.info[0].Title, "Auth Acceptance Alpha vs Beta");
  assert.equal((await call("Client_GetUserInfo")).info.UserName, "river");
  assert.deepEqual(await call("Client_GetData", { key: "ACCOUNT" }), []);
  assert.deepEqual((await call("Client_GetAccounts")).info, []);
  assert.equal((await call("Client_GetOrderList", { date: "2026-10-03" })).info.total, 0);
  const before = await call("Client_GetData", { key: "USERCONFIG" });
  const setting = { authAcceptance: label };
  assert.equal((await call("Client_SaveData", { key: "USERCONFIG", content: JSON.stringify(setting) })).success, 1);
  assert.deepEqual(await call("Client_GetData", { key: "USERCONFIG" }), setting);
  await call("Client_SaveData", { key: "USERCONFIG", content: JSON.stringify(before) });
  assert.equal((await call("Client_AdminLeaderboardUsers")).success, 0);
  checks.push(label + ":matches-user-accounts-orders-settings-admin-denial");
}
await business(web, "cookie");
const denied = await json("/esport/Client_SaveData", { cookie, "x-changmen-auth": "cookie" }, { key: "USERCONFIG", content: "{}" });
assert.equal(denied.body.code, "CSRF_INVALID");
checks.push("missing-csrf-denied-before-business-write");
const bridge = await json("/esport/Client_RefreshToken", { cookie }, {});
assert.equal(bridge.body.success, 1);
await business({ token: bridge.body.info.token }, "jwt-without-cookie");
const legacy = await json("/esport/Client_Login", {}, credentials);
assert.equal(legacy.body.success, 1);
assert.ok(legacy.body.info.token);
await business({ token: legacy.body.info.token }, "legacy-login");
assert.equal((await json("/auth/session", { cookie })).status, 401);
checks.push("old-cookie-revoked-by-legacy-login");
const result = { passed: true, checks, transactionsSent: 0, database: "dedicated-local-fixture" };
mkdirSync("output", { recursive: true });
writeFileSync("output/auth-acceptance-business.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));

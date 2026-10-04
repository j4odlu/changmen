import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { readRayConfig, readRayToken, readRayPageSession } from "./src/content/ray-credential.js";

function storage(entries) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: i => [...map.keys()][i] ?? null,
    getItem: key => map.get(key) ?? null,
  };
}

const suffixed = "socketcluster.authToken.cfsocket.365raylinks.com";
assert.equal(readRayToken(storage({ [suffixed]: "socket-jwt" })), "socket-jwt");
assert.equal(readRayToken(storage({ "socketCluster.authToken.cfsocket.365raylinks.com": "socket-jwt" })), "socket-jwt");
assert.equal(readRayToken(storage({ "socketcluster.authToken": "socket-jwt" })), "socket-jwt");
assert.equal(readRayToken(storage({ gameAuthToken: "game-jwt", "socketCluster.authToken": "legacy-jwt", [suffixed]: "socket-jwt" })), "game-jwt");
assert.equal(readRayToken(storage({ "socketCluster.authToken": "legacy-jwt", [suffixed]: "socket-jwt" })), "legacy-jwt");
assert.equal(readRayToken(storage({ userToken: JSON.stringify({ JWT: "user-jwt" }), [suffixed]: "socket-jwt" })), "user-jwt");
assert.equal(readRayToken(storage({ userToken: "{invalid", [suffixed]: "socket-jwt" })), "socket-jwt");
assert.equal(readRayToken(storage({ "socketcluster.authToken.old.example": "", [suffixed]: "socket-jwt" })), "socket-jwt");
assert.equal(readRayToken(storage({ platformToken: "not-a-socket-token", "other.authToken.example": "unrelated" })), undefined);
assert.equal(readRayToken(storage({})), undefined);
let configRequests = 0;
const fetchConfig = async (url, options) => {
  if (url.endsWith("/v2/user")) {
    assert.ok(options.headers.authorization.startsWith("Bearer "));
    return { json: async () => ({ code: 200, result: { balance: 0, id: 123 } }) };
  }
  configRequests++;
  assert.equal(url, "https://api.365raylinks.com/configv4?platform=1");
  return { json: async () => ({ data: { game_api: [
    "https://first.example:8443/v2/", "https://second.example/v2",
  ] } }) };
};
const referer = "https://ray164.com/";
for (const entries of [{ gameAuthToken: "game-jwt" }, { [suffixed]: "socket-jwt" }]) {
  const config = await readRayConfig(storage(entries), referer, fetchConfig);
  const payload = { provider: "RAY", gateway: ["https://first.example:8443", "https://second.example"], token: `Bearer ${Object.values(entries)[0]}`, referer };
  assert.deepEqual(config, { ...payload, gateway: payload.gateway[0], data: btoa(JSON.stringify(payload)) });
  assert.deepEqual(JSON.parse(atob(config.data)), payload);
}
assert.equal((await readRayConfig(storage({ gameAuthToken: "Bearer existing" }), referer, fetchConfig)).token, "Bearer existing");
const requestsBefore = configRequests;
assert.equal(await readRayConfig(storage({}), referer, fetchConfig), undefined);
assert.equal(configRequests, requestsBefore, "no token: do not request config");
for (const config of [{}, { data: { game_api: [] } }, { data: { game_api: ["bad-url"] } }, { data: { game_api: ["javascript:bad"] } }]) {
  const result = await readRayConfig(storage({ gameAuthToken: "game-jwt" }), referer, async () => ({ json: async () => config }));
  assert.ok(result.error);
  assert.equal(result.data, undefined);
  assert.equal(result.gateway, undefined);
}
assert.ok((await readRayConfig(storage({ gameAuthToken: "game-jwt" }), referer, async () => { throw new Error("offline"); })).error);

// Regression: only SocketCluster JWT in storage; HTTP token now lives in Vue memory.
const requestedAuth = [];
const modernFetch = async (url, options) => {
  if (url.includes("configv4")) return fetchConfig(url, options);
  requestedAuth.push(options.headers.authorization);
  return { json: async () => options.headers.authorization === "Bearer live-http-jwt"
    ? { code: 200, result: { balance: "12.50", id: 123 } }
    : { code: 401, desc: "TOKEN_ERROR", result: {} } };
};
const session = { token: "live-http-jwt", gateway: "https://second.example/v2" };
const modern = await readRayConfig(storage({ [suffixed]: "socket-jwt", gameAuthToken: "stale-jwt" }), referer, modernFetch, session);
assert.equal(modern.token, "Bearer live-http-jwt");
assert.equal(modern.gateway, "https://second.example");
assert.deepEqual(requestedAuth, ["Bearer live-http-jwt"]);
const socketOnly = await readRayConfig(storage({ [suffixed]: "socket-jwt" }), referer, modernFetch);
assert.match(socketOnly.error, /TOKEN_ERROR/);
assert.equal(socketOnly.data, undefined);
const failover = await readRayConfig(storage({ gameAuthToken: "live-http-jwt" }), referer, async (url, options) => {
  if (url.includes("configv4")) return fetchConfig(url, options);
  if (url.startsWith("https://first.example")) throw new Error("unreachable");
  return modernFetch(url, options);
});
assert.equal(failover.gateway, "https://second.example");

const hookSource = fs.readFileSync(new URL("./src/content/page-hooks/ray-session.js", import.meta.url), "utf8");
let runtimeToken = "live-http-jwt";
let isRay = true;
const messages = [];
const listeners = new Set();
const root = { __vue__: { $store: { state: { gameAccount: {} }, getters: { gameAPI: "https://second.example/v2" } } } };
Object.defineProperty(root.__vue__.$store.state.gameAccount, "authToken", { get: () => runtimeToken });
const win = {
  location: { origin: "https://ray164.com" },
  addEventListener: (type, listener) => listeners.add(listener),
  removeEventListener: (type, listener) => listeners.delete(listener),
  postMessage: data => {
    messages.push(data);
    queueMicrotask(() => {
      for (const listener of [...listeners]) listener({ source: win, origin: win.location.origin, data });
    });
  },
};
const context = { window: win, location: win.location, document: { querySelector: selector => selector === "#app" ? root : isRay ? {} : null } };
vm.runInNewContext(hookSource, context);
vm.runInNewContext(hookSource, context);
assert.equal(listeners.size, 1, "install once");
assert.deepEqual(JSON.parse(JSON.stringify(await readRayPageSession(win))), session);
runtimeToken = "refreshed-http-jwt";
assert.equal((await readRayPageSession(win)).token, runtimeToken, "read current token each click");
assert.equal(listeners.size, 1, "content listener cleaned up");
context.document.querySelector = selector => selector === "#app" ? null : isRay ? { parentElement: root } : null;
assert.equal((await readRayPageSession(win)).token, runtimeToken, "Vue replaced #app: read header ancestor store");
isRay = false;
assert.equal(await readRayPageSession(win), undefined, "do not extract credentials on unrelated pages");
const postedBefore = messages.length;
for (const listener of listeners) listener({ source: {}, origin: win.location.origin, data: { source: "changmen-ray-session-request", requestId: "foreign" } });
assert.equal(messages.length, postedBefore, "ignore foreign frame messages");
console.log("ray-credential: ok");

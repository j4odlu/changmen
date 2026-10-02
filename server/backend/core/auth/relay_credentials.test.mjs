import http from "node:http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("./http_identity.js", () => ({
  requireHttpUser: async () => ({ user: { id: "fixture-user" } }),
  readAccessToken: req => req.headers.token || String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""),
}));

const saved = { ...process.env };
let upstream, relay, base, upstreamUrl;
function listen(server) {
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}
function request(headers) {
  return new Promise((resolve, reject) => {
    const req = http.get(base + "/esport/http-relay", { headers: { ...headers, "x-proxy-url": upstreamUrl, "x-api-key": "venue-key" } }, res => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: JSON.parse(data) }));
    });
    req.on("error", reject);
  });
}
beforeAll(async () => {
  process.env.HTTP_RELAY_REQUIRE_TOKEN = "1";
  process.env.HTTP_RELAY_ALLOW_PRIVATE = "1";
  process.env.HTTP_RELAY_ALLOWED_HOSTS = "127.0.0.1";
  const { tryHttpProxyRelay } = await import("../../proxy/http_proxy_relay.js");
  upstream = http.createServer((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(req.headers)); });
  upstreamUrl = await listen(upstream);
  relay = http.createServer((req, res) => { void tryHttpProxyRelay(req, res, base); });
  base = await listen(relay);
});
afterAll(async () => {
  for (const server of [relay, upstream]) if (server) await new Promise(resolve => server.close(resolve));
  process.env = { ...saved };
});
it.each([
  { authorization: "Bearer app-jwt", token: "app-jwt" },
  { cookie: "cm_session=app-session", "x-csrf-token": "app-csrf", "x-changmen-auth": "cookie" },
])("does not forward application credentials to a venue: %j", async headers => {
  const result = await request(headers);
  expect(result.status).toBe(200);
  for (const name of ["authorization", "token", "cookie", "x-csrf-token", "x-changmen-auth"])
    expect(result.headers).not.toHaveProperty(name);
  expect(result.headers["x-api-key"]).toBe("venue-key");
});
it.each([
  { token: "app-jwt", authorization: "Bearer venue-token" },
  { cookie: "cm_session=app-session", "x-changmen-auth": "cookie", "x-csrf-token": "app-csrf", authorization: "Bearer venue-token" },
])("preserves a separate venue Bearer credential: %j", async headers => {
  const result = await request(headers);
  expect(result.status).toBe(200);
  expect(result.headers.authorization).toBe("Bearer venue-token");
  for (const name of ["token", "cookie", "x-csrf-token", "x-changmen-auth"])
    expect(result.headers).not.toHaveProperty(name);
});

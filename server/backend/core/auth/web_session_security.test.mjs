import { afterEach, describe, expect, it } from "vitest";
import { sessionCsrf, validAuthOrigin, validSessionCsrf, webCookieEnabled } from "./web_session_security.js";
const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });
const session = { id: "browser-id", jwtSessionId: "login-epoch" };
describe("Cookie CSRF and deployment configuration", () => {
  it("rejects missing, null, other-site and alias origins", () => {
    process.env.NODE_ENV = "production";
    delete process.env.WEB_AUTH_ORIGINS;
    for (const origin of [undefined, "null", "https://evil.example", "https://www.changmen.fun"])
      expect(validAuthOrigin({ headers: { origin } })).toBe(false);
    expect(validAuthOrigin({ headers: { origin: "https://changmen.fun" } })).toBe(true);
  });
  it("binds CSRF to both browser session and login epoch", () => {
    process.env.WEB_AUTH_CSRF_SECRET = "independent-csrf-secret-at-least-32-bytes";
    process.env.WEB_AUTH_ORIGINS = "https://changmen.fun";
    const token = sessionCsrf(session);
    const req = { headers: { origin: "https://changmen.fun", "x-csrf-token": token } };
    expect(validSessionCsrf(req, session)).toBe(true);
    expect(validSessionCsrf(req, { ...session, id: "new-session" })).toBe(false);
    expect(validSessionCsrf(req, { ...session, jwtSessionId: "new-login" })).toBe(false);
    expect(validSessionCsrf({ headers: { ...req.headers, origin: "https://evil.example" } }, session)).toBe(false);
    expect(validSessionCsrf({ headers: { origin: req.headers.origin, token: "placeholder" } }, session)).toBe(false);
  });
  it("requires enabled flag and an independent CSRF key", () => {
    delete process.env.WEB_AUTH_COOKIE_ENABLED;

    process.env.WEB_AUTH_CSRF_SECRET = "configured-csrf-secret-at-least-32-bytes";
    expect(webCookieEnabled()).toBe(false);
    process.env.WEB_AUTH_COOKIE_ENABLED = "1";
    expect(webCookieEnabled()).toBe(true);

    delete process.env.WEB_AUTH_CSRF_SECRET;
    expect(webCookieEnabled()).toBe(false);
  });
  it("accepts API-host matcher writes only with explicit Origin and matching CSRF", () => {
    process.env.WEB_AUTH_CSRF_SECRET = "independent-csrf-secret-at-least-32-bytes";
    process.env.WEB_AUTH_ORIGINS = "https://changmen.fun,https://www.changmen.fun,https://api.changmen.fun";
    const req = { headers: { origin: "https://api.changmen.fun", "x-csrf-token": sessionCsrf(session) } };
    expect(validSessionCsrf(req, session)).toBe(true);
    expect(validSessionCsrf({ headers: { ...req.headers, origin: "https://evil.changmen.fun" } }, session)).toBe(false);
    expect(validSessionCsrf({ headers: { origin: req.headers.origin } }, session)).toBe(false);
  });
});

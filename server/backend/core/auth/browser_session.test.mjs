import { afterEach, describe, expect, it } from "vitest";
import {
  browserSessionEnabled,
  browserSessionCookieName,
  clearBrowserSessionCookie,
  readBrowserSessionCookie,
  setBrowserSessionCookie,
} from "./browser_session.js";

const originalNodeEnv = process.env.NODE_ENV;
const originalAuthMode = process.env.AUTH_MODE;

afterEach(() => {
  if (originalNodeEnv === undefined)
    delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalAuthMode === undefined)
    delete process.env.AUTH_MODE;
  else process.env.AUTH_MODE = originalAuthMode;
});

function responseStub() {
  const headers = new Map();
  return {
    headers,
    setHeader(name, value) { headers.set(name, value); },
  };
}

describe("browser session cookie", () => {
  it("upgrades the historical jwt mode while keeping an explicit rollback switch", () => {
    process.env.AUTH_MODE = "jwt";
    expect(browserSessionEnabled()).toBe(true);
    process.env.AUTH_MODE = "legacy";
    expect(browserSessionEnabled()).toBe(false);
  });

  it("uses a Secure __Host cookie in production", () => {
    process.env.NODE_ENV = "production";
    const res = responseStub();
    setBrowserSessionCookie(res, "secret.value", Date.now() + 60_000);
    const value = res.headers.get("Set-Cookie");
    expect(browserSessionCookieName()).toBe("__Host-cm_session");
    expect(value).toContain("HttpOnly");
    expect(value).toContain("SameSite=Strict");
    expect(value).toContain("; Secure");
    expect(value).not.toContain("Domain=");
  });

  it("round-trips encoded cookie values and clears them", () => {
    process.env.NODE_ENV = "development";
    expect(readBrowserSessionCookie({ headers: { cookie: "x=1; cm_session=a%2Eb" } })).toBe("a.b");
    const res = responseStub();
    clearBrowserSessionCookie(res);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});

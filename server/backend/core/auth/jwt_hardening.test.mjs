import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  JWT_AUDIENCE,
  JWT_BROWSER_ACCESS_TTL_SEC,
  JWT_ISSUER,
  signJwt,
  verifyJwt,
} from "../../../db/rds/jwt.js";

const secret = "test-secret-that-is-long-enough-for-hs256";

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function legacyToken(payload, header = { alg: "HS256", typ: "JWT" }) {
  const h = encode(header);
  const p = encode(payload);
  const sig = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

describe("JWT hardening", () => {
  it("defaults browser access tokens to 15 minutes independently", () => {
    expect(JWT_BROWSER_ACCESS_TTL_SEC).toBe(15 * 60);
  });

  it("signs and validates issuer, audience and token id", () => {
    const payload = verifyJwt(signJwt({ sub: "user-1", typ: "access" }, secret, 60), secret);
    expect(payload).toMatchObject({ sub: "user-1", iss: JWT_ISSUER, aud: JWT_AUDIENCE });
    expect(payload.jti).toBeTruthy();
  });

  it("rejects algorithm confusion even with a valid HMAC", () => {
    const token = legacyToken(
      { sub: "user-1", exp: Math.floor(Date.now() / 1000) + 60 },
      { alg: "none", typ: "JWT" },
    );
    expect(verifyJwt(token, secret)).toBeNull();
  });

  it("accepts already-issued legacy HS256 tokens during migration", () => {
    const token = legacyToken({ sub: "user-1", typ: "access", exp: Math.floor(Date.now() / 1000) + 60 });
    expect(verifyJwt(token, secret)?.sub).toBe("user-1");
  });
});

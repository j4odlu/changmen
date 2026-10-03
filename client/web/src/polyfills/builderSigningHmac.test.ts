import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildHmacSignature } from "./builderSigningHmac";

describe("browser builder HMAC compatibility", () => {
  it.each([undefined, "", '{"amount":"12.5","memo":"测试"}'])
    ("matches the SDK's Node HMAC for body %s, including base64 padding", (body) => {
      const secret = Buffer.from("builder-test-secret").toString("base64");
      const timestamp = 1720000000;
      const expected = createHmac("sha256", Buffer.from(secret, "base64"))
        .update(`${timestamp}POST/submit${body ?? ""}`)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      expect(buildHmacSignature(secret, timestamp, "POST", "/submit", body)).toBe(expected);
      expect(expected).toMatch(/=$/);
    });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  checkLoginRateLimit,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginRateLimitForTests,
} from "./login_rate_limit.js";

describe("login rate limit", () => {
  beforeEach(() => resetLoginRateLimitForTests());

  it("limits repeated failures for one account and IP", () => {
    for (let i = 0; i < 8; i += 1)
      recordLoginFailure("Alice", "1.2.3.4", 1_000);
    expect(checkLoginRateLimit("alice", "1.2.3.4", 1_001).limited).toBe(true);
  });

  it("does not let one IP lock the account for another IP", () => {
    for (let i = 0; i < 8; i += 1)
      recordLoginFailure("Alice", "1.2.3.4", 1_000);
    expect(checkLoginRateLimit("alice", "5.6.7.8", 1_001).limited).toBe(false);
  });

  it("clears the account/IP bucket after a successful login", () => {
    for (let i = 0; i < 7; i += 1)
      recordLoginFailure("Alice", "1.2.3.4", 1_000);
    recordLoginSuccess("Alice", "1.2.3.4");
    expect(checkLoginRateLimit("alice", "1.2.3.4", 1_001).limited).toBe(false);
  });
});

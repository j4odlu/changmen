import { describe, expect, it } from "vitest";
import { accountOrderDisplayName, accountProgressDisplayName } from "./accountDisplayName";

describe("accountOrderDisplayName", () => {
  it("prefers venueAccountName over playerName", () => {
    expect(accountOrderDisplayName({
      venueAccountName: "ray_user",
      playerName: "legacy",
      accountId: 1,
    })).toBe("ray_user");
  });

  it("falls back to playerName", () => {
    expect(accountOrderDisplayName({ playerName: "legacy", accountId: 1 })).toBe("legacy");
  });

  it("falls back to account id", () => {
    expect(accountOrderDisplayName({ accountId: 42 })).toBe("#42");
  });
});

describe("实时进度账号名称", () => {
  it("uses the same name as the account list", () => {
    const account = { venueAccountName: " pm_user ", playerName: "wallet", accountId: 292 };
    expect(accountProgressDisplayName(account)).toBe(accountOrderDisplayName(account));
    expect(accountProgressDisplayName({ playerName: " ray_user " })).toBe("ray_user");
  });

  it("never exposes an internal account id when names are missing", () => {
    const account = { accountId: 292, venueAccountName: " ", playerName: " " };
    expect(accountProgressDisplayName(account)).toBe("名称不可用");
    expect(accountProgressDisplayName(undefined)).toBe("名称不可用");
    expect(accountProgressDisplayName(null)).toBe("名称不可用");
    expect(accountOrderDisplayName(account)).toBe("#292");
  });
});

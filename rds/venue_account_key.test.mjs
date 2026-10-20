import { describe, expect, it } from "vitest";

import {
  buildVenueAccountKey,
  buildVenueAccountKeyFromRecord,
  venueAccountKeyConflictMessage,
} from "./venue_account_key.js";

describe("venue_account_key", () => {
  it("prefers venue_member_id over credentials", () => {
    expect(buildVenueAccountKey({
      provider: "OB",
      venueMemberId: "610738",
      gateway: "https://x.com/",
      token: "abc",
    })).toBe("ob:member:610738");
  });

  it("hashes gateway+token when member id missing", () => {
    const a = buildVenueAccountKey({
      provider: "PB",
      gateway: "https://api.example.com/",
      token: "secret",
    });
    const b = buildVenueAccountKey({
      provider: "pb",
      gateway: "https://api.example.com",
      token: "secret",
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^pb:cred:[a-f0-9]{32}$/);
  });

  it("returns empty without provider or identifiers", () => {
    expect(buildVenueAccountKey({ provider: "OB" })).toBe("");
    expect(buildVenueAccountKeyFromRecord({ gateway: "x", token: "y" })).toBe("");
  });

  it("conflict message mentions soft-delete revive rule", () => {
    expect(venueAccountKeyConflictMessage({
      id: 9,
      userName: "GB01",
      deletedAt: 1,
    })).toContain("已删除，仅原主人可通过添加账号复活");
    expect(venueAccountKeyConflictMessage({
      id: 9,
      userName: "GB01",
    })).toBe("该场馆操盘账号已被用户 GB01 占用（player 9）");
  });

  it("own soft-deleted message steers to revive", async () => {
    const { ownSoftDeletedVenueAccountMessage } = await import("./venue_account_key.js");
    expect(ownSoftDeletedVenueAccountMessage({ id: 3 })).toContain("请用添加账号复活");
  });
});

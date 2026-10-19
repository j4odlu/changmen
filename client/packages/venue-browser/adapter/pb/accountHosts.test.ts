import { describe, expect, test } from "vitest";
import {
  getPbAccountPageHosts,
  hostnameMatchesPbAccountHosts,
  pbHostFromUrl,
  pbHostsFromAccounts,
  resetPbAccountPageHostsForTests,
  setPbAccountPageHosts,
} from "./accountHosts";

describe("pbHostsFromAccounts", () => {
  test("prefers referer host over gateway", () => {
    expect(pbHostsFromAccounts([
      {
        provider: "PB",
        referer: "https://skin.example/zh-cn/compact/sports/soccer",
        gateway: "https://www.part888.com",
      },
    ])).toEqual(["skin.example"]);
  });

  test("falls back to gateway when referer missing", () => {
    expect(pbHostsFromAccounts([
      { provider: "PB", gateway: "https://www.ps3838.com" },
    ])).toEqual(["www.ps3838.com"]);
  });

  test("ignores non-PB accounts", () => {
    expect(pbHostsFromAccounts([
      { provider: "OB", referer: "https://ob.example/" },
      { provider: "PB", referer: "https://pb.example/sports" },
    ])).toEqual(["pb.example"]);
  });

  test("dedupes hosts", () => {
    expect(pbHostsFromAccounts([
      { provider: "PB", referer: "https://www.pb.example/a" },
      { provider: "pb", gateway: "https://www.pb.example" },
    ])).toEqual(["www.pb.example"]);
  });
});

describe("hostnameMatchesPbAccountHosts", () => {
  test("matches exact and subdomain", () => {
    expect(hostnameMatchesPbAccountHosts("www.pb.example", ["pb.example"])).toBe(true);
    expect(hostnameMatchesPbAccountHosts("pb.example", ["www.pb.example"])).toBe(true);
    expect(hostnameMatchesPbAccountHosts("other.example", ["pb.example"])).toBe(false);
  });
});

describe("pbHostFromUrl", () => {
  test("accepts host without scheme", () => {
    expect(pbHostFromUrl("www.part888.com")).toBe("www.part888.com");
  });
});

describe("page hosts gate", () => {
  test("roundtrip", () => {
    resetPbAccountPageHostsForTests();
    setPbAccountPageHosts(["WWW.Foo.COM", "www.foo.com"]);
    expect(getPbAccountPageHosts()).toEqual(["www.foo.com"]);
    resetPbAccountPageHostsForTests();
    expect(getPbAccountPageHosts()).toEqual([]);
  });
});

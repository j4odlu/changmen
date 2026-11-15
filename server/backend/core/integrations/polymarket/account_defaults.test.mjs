import { beforeEach, expect, it, vi } from "vitest";
import { enrichPmAccountFromPlatformDefaults } from "./account_defaults.js";
import store from "../../esport-api/store.js";

vi.mock("../../esport-api/store.js", () => ({ default: { getPlatform: vi.fn() } }));

beforeEach(() => vi.resetAllMocks());

it("keeps complete credentials unchanged without consulting platform defaults", () => {
  const account = { provider: "Polymarket", gateway: "account-gateway", token: "account-token" };
  expect(enrichPmAccountFromPlatformDefaults(account)).toBe(account);
  expect(store.getPlatform).not.toHaveBeenCalled();
});

it.each([
  [{ provider: "polymarket" }, { gateway: "default-gateway", token: "default-token", referer: "default-referer" }],
  [{ provider: "Polymarket", token: "account-token" }, { gateway: "default-gateway", token: "account-token", referer: "default-referer" }],
  [{ provider: "Polymarket", gateway: "account-gateway", referer: "account-referer" }, { gateway: "account-gateway", token: "default-token", referer: "account-referer" }],
])("fills only missing fields and leaves the original account intact: %j", (account, expected) => {
  store.getPlatform.mockReturnValue({ gateway: "default-gateway", token: "default-token", referer: "default-referer" });
  const original = structuredClone(account);
  expect(enrichPmAccountFromPlatformDefaults(account)).toEqual({ ...account, ...expected });
  expect(store.getPlatform).toHaveBeenCalledWith("POLYMARKET");
  expect(account).toEqual(original);
});

it("uses the platform gateway as the referer fallback", () => {
  store.getPlatform.mockReturnValue({ gateway: "default-gateway", token: "default-token" });
  expect(enrichPmAccountFromPlatformDefaults({ provider: "Polymarket" }).referer).toBe("default-gateway");
});

it.each([undefined, {}, { gateway: "default-gateway" }, { token: "default-token" }])(
  "keeps the existing account when platform defaults are incomplete: %j", defaults => {
    store.getPlatform.mockReturnValue(defaults);
    const account = { provider: "Polymarket", token: "account-token" };
    expect(enrichPmAccountFromPlatformDefaults(account)).toBe(account);
  },
);

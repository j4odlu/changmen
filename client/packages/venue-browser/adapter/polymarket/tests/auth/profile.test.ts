import { describe, expect, it, vi, beforeEach } from "vitest";

const polymarketPluginGet = vi.fn();
vi.mock("@changmen/venue-browser/polymarket/transport/transport", () => ({
  polymarketPluginGet: (...args: unknown[]) => polymarketPluginGet(...args),
}));

import {
  mapPolymarketPublicProfile,
  resolvePolymarketProfileAddress,
  resolvePolymarketVenueIdentityFromToken,
} from "@changmen/venue-browser/polymarket/auth/profile";

describe("polymarket profile", () => {
  beforeEach(() => {
    polymarketPluginGet.mockReset();
  });

  it("prefers funder over wallet for profile address", () => {
    expect(resolvePolymarketProfileAddress({
      walletAddress: "0xCa4c007bdc8087F13141046Dc38F2f79F87cf43e",
      funder: "0x3eDBB2D5649B2c07eeFe12fBFe2c733F148C11b8",
    })).toBe("0x3edbb2d5649b2c07eefe12fbfe2c733f148c11b8");
  });

  it("maps name + users[0].id", () => {
    expect(mapPolymarketPublicProfile({
      name: "107D8f7",
      pseudonym: "Damaged-Takeout",
      proxyWallet: "0x3edbb2d5649b2c07eefe12fbfe2c733f148c11b8",
      users: [{ id: "8946397" }],
    })).toEqual({
      venueMemberId: "8946397",
      venueAccountName: "107D8f7",
      proxyWallet: "0x3edbb2d5649b2c07eefe12fbfe2c733f148c11b8",
    });
  });

  it("falls back to pseudonym when name missing", () => {
    expect(mapPolymarketPublicProfile({
      pseudonym: "Damaged-Takeout",
      users: [{ id: "1" }],
    })?.venueAccountName).toBe("Damaged-Takeout");
  });

  it("resolves identity from token via gamma public-profile", async () => {
    polymarketPluginGet.mockResolvedValue({
      name: "107D8f7",
      users: [{ id: "8946397" }],
      proxyWallet: "0x3edbb2d5649b2c07eefe12fbfe2c733f148c11b8",
    });
    const identity = await resolvePolymarketVenueIdentityFromToken(JSON.stringify({
      funder: "0x3eDBB2D5649B2c07eeFe12fBFe2c733F148C11b8",
    }));
    expect(identity).toEqual({
      venueMemberId: "8946397",
      venueAccountName: "107D8f7",
      proxyWallet: "0x3edbb2d5649b2c07eefe12fbfe2c733f148c11b8",
    });
    expect(polymarketPluginGet).toHaveBeenCalledWith(
      "https://gamma-api.polymarket.com/public-profile?address=0x3edbb2d5649b2c07eefe12fbfe2c733f148c11b8",
    );
  });

  it.each([undefined, {}, { name: "unbound-name" }])(
    "queries the signer when the deposit wallet has no usable profile: %j",
    async (profile) => {
      polymarketPluginGet.mockResolvedValueOnce(profile).mockResolvedValueOnce({
        name: "pm-user", users: [{ id: "99" }],
      });
      await expect(resolvePolymarketVenueIdentityFromToken(JSON.stringify({
        funder: `0x${"1".repeat(40)}`,
        walletAddress: `0x${"2".repeat(40)}`,
      }))).resolves.toMatchObject({ venueMemberId: "99", venueAccountName: "pm-user" });
      expect(polymarketPluginGet.mock.calls.map(([url]) => url)).toEqual([
        `https://gamma-api.polymarket.com/public-profile?address=0x${"1".repeat(40)}`,
        `https://gamma-api.polymarket.com/public-profile?address=0x${"2".repeat(40)}`,
      ]);
    },
  );

  it("recovers from a deposit-wallet 404 using the signer address alias", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      polymarketPluginGet.mockRejectedValueOnce(new Error("HTTP 404"))
        .mockResolvedValueOnce({ name: "pm-user", users: [{ id: "99" }] });
      await expect(resolvePolymarketVenueIdentityFromToken(JSON.stringify({
        funderAddress: `0x${"1".repeat(40)}`, address: `0x${"2".repeat(40)}`,
      }))).resolves.toMatchObject({ venueMemberId: "99" });
      expect(polymarketPluginGet).toHaveBeenCalledTimes(2);
    }
    finally { warn.mockRestore(); }
  });

  it("keeps the funder identity when its profile exists", async () => {
    polymarketPluginGet.mockResolvedValueOnce({ users: [{ id: "99" }] });
    await expect(resolvePolymarketVenueIdentityFromToken(JSON.stringify({
      funder: `0x${"1".repeat(40)}`, walletAddress: `0x${"2".repeat(40)}`,
    }))).resolves.toMatchObject({ venueMemberId: "99" });
    expect(polymarketPluginGet).toHaveBeenCalledOnce();
  });

  it("does not invent an identity or repeat a lookup for the same address", async () => {
    polymarketPluginGet.mockResolvedValue(undefined);
    await expect(resolvePolymarketVenueIdentityFromToken(JSON.stringify({
      funder: `0x${"a".repeat(40)}`, walletAddress: `0x${"A".repeat(40)}`,
    }))).resolves.toBeUndefined();
    expect(polymarketPluginGet).toHaveBeenCalledOnce();
  });

  it("returns no identity when neither wallet has a public profile", async () => {
    polymarketPluginGet.mockResolvedValue(undefined);
    await expect(resolvePolymarketVenueIdentityFromToken(JSON.stringify({
      funder: `0x${"1".repeat(40)}`, walletAddress: `0x${"2".repeat(40)}`,
    }))).resolves.toBeUndefined();
    expect(polymarketPluginGet).toHaveBeenCalledTimes(2);
  });
});

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
});

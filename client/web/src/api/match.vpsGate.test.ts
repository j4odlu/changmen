import { describe, expect, it, vi } from "vitest";
import { isVpsOwnedPlatformCollect } from "@changmen/venue-browser/adapter/registry";
import { saveBetSource, saveLiveTimer, saveMatchSource } from "./match";
import { postForm } from "@/api/client";

vi.mock("@/api/client", () => ({
  post: vi.fn(),
  postForm: vi.fn(async () => ({ success: 1 })),
  unwrap: vi.fn(),
}));

describe("api/match VPS Save* gate", () => {
  it("adds raw result facts only to the existing RAY SaveBet request", async () => {
    const matchResult = { id: "1", status: 1, odds: [{ win: 1 }] };
    await saveBetSource("RAY", "1", [], matchResult);
    expect(postForm).toHaveBeenLastCalledWith("API_SaveBet?RAY", {
      provider: "RAY", matchId: "1", bets: "[]", matchResult: JSON.stringify(matchResult),
    });
    await saveBetSource("OB", "1", [], matchResult);
    expect(postForm).toHaveBeenLastCalledWith("API_SaveBet?OB", { provider: "OB", matchId: "1", bets: "[]" });
    await saveBetSource("RAY", "1", []);
    expect(postForm).toHaveBeenLastCalledWith("API_SaveBet?RAY", { provider: "RAY", matchId: "1", bets: "[]" });
  });
  it("blocks Save* for every vps_http_ws platform from manifest", async () => {
    expect(isVpsOwnedPlatformCollect("PredictFun")).toBe(true);
    expect(isVpsOwnedPlatformCollect("Polymarket")).toBe(true);
    expect(isVpsOwnedPlatformCollect("SXBet")).toBe(true);
    expect(await saveMatchSource("PredictFun", [])).toBe(false);
    expect(await saveMatchSource("Polymarket", [])).toBe(false);
    expect(await saveMatchSource("SXBet", [])).toBe(false);
    expect(await saveBetSource("PredictFun", "1", [])).toBe(false);
    expect(await saveBetSource("Polymarket", "1", [])).toBe(false);
    expect(await saveBetSource("SXBet", "1", [])).toBe(false);
    expect(await saveLiveTimer("PredictFun", [])).toBe(false);
    expect(await saveLiveTimer("Polymarket", [])).toBe(false);
    expect(await saveLiveTimer("SXBet", [])).toBe(false);
  });

  it("allows classic browser Save* platforms through the gate", async () => {
    expect(isVpsOwnedPlatformCollect("OB")).toBe(false);
    expect(await saveMatchSource("OB", [])).toBe(true);
    expect(await saveBetSource("OB", "1", [])).toBe(true);
    expect(await saveLiveTimer("OB", [])).toBe(true);
  });
});

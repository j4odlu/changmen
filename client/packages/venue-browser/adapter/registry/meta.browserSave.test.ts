import { describe, expect, it } from "vitest";
import {
  browserSaveMatchPlatformIds,
  getPlatformMeta,
  isVpsOwnedPlatformCollect,
} from "./meta";

describe("browserSaveMatchPlatformIds", () => {
  it("excludes VPS index platforms (Polymarket, PredictFun)", () => {
    const ids = browserSaveMatchPlatformIds();
    expect(ids).not.toContain("Polymarket");
    expect(ids).not.toContain("PredictFun");
    expect(getPlatformMeta("Polymarket")?.collectionMode).toBe("vps_http_ws");
    expect(getPlatformMeta("PredictFun")?.collectionMode).toBe("vps_http_ws");
  });

  it("still includes classic browser Save* platforms", () => {
    const ids = browserSaveMatchPlatformIds();
    expect(ids).toContain("OB");
  });
});

describe("isVpsOwnedPlatformCollect", () => {
  it("is true iff collectionMode is vps_http_ws", () => {
    expect(isVpsOwnedPlatformCollect("Polymarket")).toBe(true);
    expect(isVpsOwnedPlatformCollect("PredictFun")).toBe(true);
    expect(isVpsOwnedPlatformCollect("OB")).toBe(false);
    expect(isVpsOwnedPlatformCollect("RAY")).toBe(false);
  });

  it("stays in sync with browserSaveMatchPlatformIds allowlist", () => {
    for (const id of browserSaveMatchPlatformIds())
      expect(isVpsOwnedPlatformCollect(id)).toBe(false);
    for (const meta of [
      getPlatformMeta("Polymarket"),
      getPlatformMeta("PredictFun"),
    ]) {
      expect(meta?.collectionMode).toBe("vps_http_ws");
      expect(isVpsOwnedPlatformCollect(meta!.id)).toBe(true);
    }
  });

  it("unknown platform is not treated as VPS-owned", () => {
    expect(isVpsOwnedPlatformCollect("NotARealVenue")).toBe(false);
  });

  it("matches feeds.js case-insensitive platform ids", () => {
    expect(isVpsOwnedPlatformCollect("predictfun")).toBe(true);
    expect(isVpsOwnedPlatformCollect("PREDICTFUN")).toBe(true);
    expect(isVpsOwnedPlatformCollect("polymarket")).toBe(true);
    expect(getPlatformMeta("ob")?.id).toBe("OB");
  });
});

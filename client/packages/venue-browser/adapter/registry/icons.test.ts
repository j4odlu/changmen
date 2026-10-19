import { describe, expect, it } from "vitest";
import { getPlatformIconFile, getPlatformIconUrl, platformIdsWithIcons } from "./icons";

describe("registry/icons", () => {
  it("resolves known platform icon URLs from manifest", () => {
    expect(getPlatformIconFile("OB")).toBe("ob.png");
    expect(getPlatformIconUrl("OB")).toBe("/assets/venue/ob.png");
    expect(getPlatformIconUrl("PB")).toBe("/assets/venue/pb.webp");
  });

  it("returns undefined for platforms without icon in manifest", () => {
    expect(getPlatformIconUrl("Azuro")).toBeUndefined();
  });

  it("lists every manifest entry that declares icon", () => {
    const ids = platformIdsWithIcons();
    expect(ids).toContain("OB");
    expect(ids).toContain("PredictFun");
    expect(ids).not.toContain("Azuro");
  });
});

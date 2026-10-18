import { expect, it } from "vitest";
import { backendPublicAssets, isLegacyPublicAsset } from "./backendPublicAssets";
it("keeps the original public URLs external while requiring a registered resource", () => {
  expect(isLegacyPublicAsset("/esport2/assets/CQ1lLIdm.woff2")).toBe(true);
  expect(isLegacyPublicAsset("/esport2/assets/rank-chip-boss.svg?url#part")).toBe(true);
  expect(isLegacyPublicAsset("/assets/other.png")).toBe(false);
  expect(backendPublicAssets().name).toBe("changmen-backend-public-assets");
});
for (const id of ["missing.svg", "../version.json", "%2e%2e%2fversion.json", "%2fetc", "%invalid", "rank-chip-boss.svg/extra"])
  it(`rejects an unregistered or escaping public asset ${id}`, () => {
    expect(() => isLegacyPublicAsset("/esport2/assets/" + id)).toThrow("后端静态资源不存在");
  });

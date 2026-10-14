import { expect, it } from "vitest";
import { runtimeBackendUrl, versionPage } from "./runtimeVersion";
it("routes version reads to the configured API without exposing URL credentials or query secrets", () => {
  expect(runtimeBackendUrl()).toBe("/api/runtime-version");
  expect(runtimeBackendUrl("https://user:secret@api.example.com/?token=secret#secret")).toBe("https://api.example.com/api/runtime-version");
  expect(() => runtimeBackendUrl("javascript:alert(1)")).toThrow();
});
it("the standalone page only reads metadata; diagnostic values are displayed as text", () => {
  const html = versionPage(); expect(html).toContain("textContent"); expect(html).not.toContain("innerHTML");
  expect(html).toContain("migrationVersion"); expect(html).toContain("restartRequired");
  expect(html).not.toMatch(/Pm_Gtc|Pm_Submit|Pm_Cancel/);
});

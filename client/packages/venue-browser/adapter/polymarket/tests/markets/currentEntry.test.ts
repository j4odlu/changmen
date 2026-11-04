import { createRequire } from "node:module";
import { expect, test } from "vitest";
import { polymarketAdapter } from "@changmen/venue-browser/polymarket";
import { polymarketProvider } from "@changmen/venue-browser/polymarket/fok/bet";
import { getAdapter } from "@changmen/venue-browser/adapter/registry/adapters";

test("registry uses the current PM entry and retired package paths cannot be resolved", () => {
  expect(getAdapter("Polymarket")).toBe(polymarketAdapter);
  expect(polymarketAdapter.provider).toBe(polymarketProvider);
  const require = createRequire(import.meta.url);
  for (const entry of ["@changmen/venue-browser/adapter/polymarket", "@changmen/venue-browser/adapter/polymarket/orders",
    "@changmen/venue-browser/adapter/polymarket/fok/bet"])
    expect(() => require.resolve(entry)).toThrow();
  expect(require.resolve("@changmen/venue-browser/polymarket")).toMatch(/polymarket[/\\]index\.ts$/);
});

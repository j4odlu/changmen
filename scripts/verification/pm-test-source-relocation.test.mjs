import assert from "node:assert/strict";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PM_TEST_RELOCATIONS, rebasePmTestImports } from "./pm-test-source-relocation.mjs";

describe("pM test file relocation", () => {
  it("registers 72 unique original tests without duplicate test discovery", () => {
    expect(Object.keys(PM_TEST_RELOCATIONS)).toHaveLength(72);
    expect(new Set(Object.values(PM_TEST_RELOCATIONS)).size).toBe(72);
    for (const [old, current] of Object.entries(PM_TEST_RELOCATIONS)) {
      assert(old.endsWith(".test.ts"));
      assert(current.includes("/tests/"));
    }
  });
  it("round-trips imports and hoisted/dynamic mock paths without changing assertions", () => {
    const from = "pm/example.test.ts"; const to = "pm/tests/orders/example.test.ts";
    const source = "import { x } from './api';\nvi.mock('./orders', () => ({ x: 1 }));\nvi.doMock('./api', () => ({ x: 2 }));\nconst load = () => import('./api');\ntype Row = import('./orders').Row;\nexpect('./orders').toBe('./orders');\n";
    const moved = rebasePmTestImports(source, from, to);
    expect(moved).toContain("vi.mock('../../orders'");
    expect(moved).toContain("vi.doMock('../../api'");
    expect(moved).toContain("expect('./orders').toBe('./orders')");
    expect(rebasePmTestImports(moved, to, from)).toBe(source);
  });
  it("redirects only the exact relocated implementation path", () => {
    const source = "const a = () => import('./orders/orderStatus');\nconst b = () => import('./orderStatus');\n";
    const redirects = { [path.posix.resolve("pm/orders/orderStatus")]: path.posix.resolve("pm/orders/facts/orderStatus") };
    const moved = rebasePmTestImports(source, "pm/example.test.ts", "pm/tests/orders/example.test.ts", redirects);
    expect(moved).toContain("import('../../orders/facts/orderStatus')");
    expect(moved).toContain("import('../../orderStatus')");
  });
  it("preserves dynamic import-based mocks and literal assertions", () => {
    const source = "vi.mock(import('./api'), () => ({}));\nvi.fn('./api');\n";
    const moved = rebasePmTestImports(source, "pm/example.test.ts", "pm/tests/orders/example.test.ts");
    expect(moved).toBe("vi.mock(import('../../api'), () => ({}));\nvi.fn('./api');\n");
  });
  it("rejects invalid TypeScript rather than partially rewriting it", () => {
    expect(() => rebasePmTestImports("import {", "pm/example.test.ts", "pm/tests/orders/example.test.ts")).toThrow("invalid TypeScript");
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = dirname(fileURLToPath(import.meta.url));

describe("Limitless collect source contracts", () => {
  test("WS quote path writes fo only; discovery may refreshOddsOnBets", () => {
    const src = readFileSync(join(root, "collect.ts"), "utf8");
    const quoteStart = src.indexOf("function updateBetFromSlug");
    const quoteEnd = src.indexOf("const wsHandle", quoteStart);
    expect(quoteStart).toBeGreaterThanOrEqual(0);
    expect(quoteEnd).toBeGreaterThan(quoteStart);
    const quoteBody = src.slice(quoteStart, quoteEnd);
    expect(quoteBody).toMatch(/saveTokenQuote\(/);
    expect(quoteBody).not.toMatch(/refreshOddsOnBets/);

    const discoveryStart = src.indexOf("const runDiscovery");
    expect(discoveryStart).toBeGreaterThanOrEqual(0);
    expect(src.slice(discoveryStart)).toMatch(/refreshOddsOnBets\(/);
  });
});

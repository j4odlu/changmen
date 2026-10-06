import { readFileSync } from "node:fs";
import { compileStyle, parse } from "@vue/compiler-sfc";
import { describe, expect, it } from "vitest";

describe("C probability row style isolation", () => {
  it("keeps compiled styles off the odds container and other rows", () => {
    const filename = new URL("../components/match/PmPrematchProbability.vue", import.meta.url);
    const { descriptor } = parse(readFileSync(filename, "utf8"));
    const result = compileStyle({ source: descriptor.styles[0]!.content, filename: filename.pathname, id: "data-v-c-row", scoped: true });
    expect(result.errors).toEqual([]);
    const selectors = Array.from(result.code.matchAll(/([^{}]+)\{/g), match => match[1]!.trim());
    expect(selectors).toHaveLength(2);
    expect(selectors.every(selector => selector.includes(".pm-prematch.item") && selector.includes("[data-v-c-row]"))).toBe(true);
    expect(selectors).not.toContain(".matchs .bet .bet-items");
  });
});

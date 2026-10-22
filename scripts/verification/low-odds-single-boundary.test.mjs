import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { LOW_ODDS_INCREMENTS, restoreLowOddsSingleSource, verifyLowOddsSingleSources } from "./low-odds-single-boundary.mjs";

const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");

describe("🎯 exact additions retain the complete ordinary-mode baseline", () => {
  it.each(Object.keys(LOW_ODDS_INCREMENTS.changes))("restores the unchanged pre-feature %s", file => {
    const before = execFileSync("git", ["show", `${LOW_ODDS_INCREMENTS.baseline}:${file}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
    expect(restoreLowOddsSingleSource(file, read(file))).toBe(before);
    expect(restoreLowOddsSingleSource(file, read(file).replaceAll("\n", "\r\n"))).toBe(before);
    const mutation = `${read(file)}\nvoid unregisteredDefaultOrder();\n`;
    expect(restoreLowOddsSingleSource(file, mutation)).toBe(mutation);
    expect(() => verifyLowOddsSingleSources(target => target === file ? mutation : read(target))).toThrow("unregistered 🎯 change");
  });

  it("verifies the real helper and rejects replacing cross-tab claiming with unconditional approval", () => {
    expect(verifyLowOddsSingleSources(read).helpers).toBe(1);
    const helper = "client/web/src/extensions/arbBet/lowOddsSingle.ts";
    expect(() => verifyLowOddsSingleSources(file => file === helper ? read(file).replace("if (keys.some(key => used.has(key))) return false;", "if (false) return false;") : read(file))).toThrow("complete 🎯 helper changed");
  });
});

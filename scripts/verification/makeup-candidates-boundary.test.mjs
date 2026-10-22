import fs from "node:fs";
import { expect, it } from "vitest";
import { makeupCandidatesExtraction as entry, restoreMakeupCandidatesSource } from "./makeup-candidates-boundary.mjs";
import { loseOrderExecutionExtraction, restoreLoseOrderExecutionSource } from "./lose-order-execution-boundary.mjs";
import { gitSource } from "./fok-exact-boundaries.mjs";

const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");

it("moves the complete existing selection block without changing any rule or call order", () => {
  const source = read(entry.candidateFile);
  const body = source.slice(source.indexOf("  const useBand ="), source.indexOf("  return { useBand, candidates };"));
  const previous = entry.changes[2][1].split("\n").map(line => line.startsWith("  ") ? line.slice(2) : line).join("\n");
  expect(body).toBe(previous);
});

it("preserves the prior entire executor and original immutable module", () => {
  const source = read(entry.file);
  const previous = restoreMakeupCandidatesSource(entry.file, source, read);
  expect(restoreMakeupCandidatesSource(entry.file, previous, read)).toBe(previous);
  expect(restoreLoseOrderExecutionSource(loseOrderExecutionExtraction.file, read(loseOrderExecutionExtraction.file), read))
    .toBe(gitSource(loseOrderExecutionExtraction.baseline, loseOrderExecutionExtraction.file));
});

it("rejects dropping the band metadata or passing a different profit setting", () => {
  const source = read(entry.file);
  for (const changed of [source.replace("{ useBand, candidates }", "{ candidates }"), source.replace("{ order, bet, config, bandPrefs }", "{ order, bet, config: { makeProfit: 1 }, bandPrefs }")]) {
    expect(changed).not.toBe(source);
    expect(() => restoreMakeupCandidatesSource(entry.file, changed, read)).toThrow();
  }
});

it.each([
  source => source.replace("banded ?? bet.items", "banded?.length ? banded : bet.items"),
  source => source.replace(">= minOdds", "> minOdds"),
  source => source.replace("[...bet.items].sort", "bet.items.sort"),
  source => source.replace("&& !order.isCreateOrder", ""),
])("rejects changed stop, threshold, input mutation or manual exceptions", (alter) => {
  const source = read(entry.candidateFile);
  expect(alter(source)).not.toBe(source);
  expect(() => restoreMakeupCandidatesSource(entry.file, read(entry.file),
    file => file === entry.candidateFile ? alter(source) : read(file))).toThrow(/makeup candidate selection/);
});

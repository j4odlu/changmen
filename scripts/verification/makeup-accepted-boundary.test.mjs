import fs from "node:fs";
import { expect, it } from "vitest";
import { makeupAcceptedExtraction as entry, restoreMakeupAcceptedSource } from "./makeup-accepted-boundary.mjs";
import { loseOrderExecutionExtraction, restoreLoseOrderExecutionSource } from "./lose-order-execution-boundary.mjs";
import { gitSource } from "./fok-exact-boundaries.mjs";

const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");

it("moves the entire receipt and routing block, returning each original confirmation promise", () => {
  const source = read(entry.helperFile);
  const body = source.slice(source.indexOf("  if (isCurrentOrder"), source.lastIndexOf("}\n"));
  const previous = entry.changes[2][1].split("\n").map(line => line.startsWith("    ") ? line.slice(4) : line).join("\n")
    .replace("    await processPmMakeUpLeg({", "    return processPmMakeUpLeg({")
    .replace("    // [A8 可证实] 确认拒单后继续下一候选；出队或仍待检测由循环顶部停止新提交。\n    continue;\n", "")
    .replace("  await processA8RegularVenueMakeUpLeg({", "  return processA8RegularVenueMakeUpLeg({");
  expect(body).toBe(previous);
  expect(source).not.toContain("async function");
});

it("restores the prior worker and the original immutable consumer without replacing old baselines", () => {
  const restored = restoreMakeupAcceptedSource(entry.file, read(entry.file), read);
  expect(restoreMakeupAcceptedSource(entry.file, restored, read)).toBe(restored);
  expect(restoreLoseOrderExecutionSource(loseOrderExecutionExtraction.file, read(loseOrderExecutionExtraction.file), read))
    .toBe(gitSource(loseOrderExecutionExtraction.baseline, loseOrderExecutionExtraction.file));
});

it.each([
  source => source.replace("if (isCurrentOrder) {", "if (true) {"),
  source => source.replace("checked.newOdds || checked.odds", "checked.odds"),
  source => source.replace("waitSec !== 0", "waitSec > 0"),
  source => source.replace("Date.now() + waitSec * 1000", "Date.now()"),
  source => source.replace("return processPmMakeUpLeg", "return Promise.resolve().then(() => processPmMakeUpLeg"),
])("rejects altered cancellation protection, receipt odds, wait conditions or confirmation timing", (alter) => {
  const source = read(entry.helperFile);
  expect(alter(source)).not.toBe(source);
  expect(() => restoreMakeupAcceptedSource(entry.file, read(entry.file),
    file => file === entry.helperFile ? alter(source) : read(file))).toThrow(/accepted-receipt handling/);
});

it.each([
  source => source.replace("if (!isCurrentOrder && !result?.success)", "if (!isCurrentOrder)"),
  source => source.replace("await completeAcceptedMakeUpLeg({", "void completeAcceptedMakeUpLeg({"),
  source => source.replace("checked, result, isCurrentOrder,", "checked, result, isCurrentOrder: true,"),
])("rejects altered failed-result gating, confirmation wait or submission-time queue identity", (alter) => {
  const source = read(entry.file);
  expect(alter(source)).not.toBe(source);
  expect(() => restoreMakeupAcceptedSource(entry.file, alter(source), read)).toThrow();
});

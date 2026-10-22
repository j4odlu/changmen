import fs from "node:fs";
import { expect, it } from "vitest";
import { arbMakeUpPendingExtraction as entry, restoreArbMakeUpPendingSource } from "./arb-makeup-pending-boundary.mjs";
import { restoreArbMakeUpPolicySource } from "./arb-makeup-policy-boundary.mjs";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { arbMakeUpPolicyExtraction } from "./arb-makeup-policy-boundary.mjs";

const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");

it("moves the existing pending handoff body without changing any statement", () => {
  const previous = entry.changes[1][1];
  const closure = previous.slice(0, previous.lastIndexOf('  if (decision.kind === "observe")'));
  const oldBody = closure.slice(closure.indexOf('  ): Promise<boolean> => {\n') + '  ): Promise<boolean> => {\n'.length, closure.lastIndexOf("  };"))
    .split("\n").map(line => line.startsWith("  ") ? line.slice(2) : line).join("\n");
  const moved = read(entry.pendingFile);
  expect(moved.slice(moved.indexOf("  const pendingResult ="), moved.lastIndexOf("}\n"))).toBe(oldBody);
});

it("restores both extraction stages to the entire original committed module", () => {
  const source = read(entry.file);
  const previous = restoreArbMakeUpPendingSource(entry.file, source, read);
  expect(restoreArbMakeUpPendingSource(entry.file, previous, read)).toBe(previous);
  expect(restoreArbMakeUpPolicySource(entry.file, source, read))
    .toBe(gitSource(arbMakeUpPolicyExtraction.baseline, entry.file));
});

it("rejects changed handoff arguments and additional orchestration behavior", () => {
  const source = read(entry.file);
  for (const changed of [source.replace("}, pendingSide, role)", '}, pendingSide, "target")'), source + "\nvoid extraHandoff();\n"]) {
    expect(changed).not.toBe(source);
    expect(() => restoreArbMakeUpPendingSource(entry.file, changed, read)).toThrow();
  }
});

it("rejects a changed admission-denied continuation in the extracted helper", () => {
  const changed = read(entry.pendingFile).replace("if (!enqueued)", "if (enqueued)");
  expect(changed).not.toBe(read(entry.pendingFile));
  expect(() => restoreArbMakeUpPolicySource(entry.file, read(entry.file),
    file => file === entry.pendingFile ? changed : read(file))).toThrow(/complete extracted makeup pending/);
});

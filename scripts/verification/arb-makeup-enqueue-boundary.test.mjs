import fs from "node:fs";
import { expect, it } from "vitest";
import { arbMakeUpEnqueueExtraction as entry, restoreArbMakeUpEnqueueSource } from "./arb-makeup-enqueue-boundary.mjs";
import { arbMakeUpPolicyExtraction, restoreArbMakeUpPolicySource } from "./arb-makeup-policy-boundary.mjs";
import { gitSource } from "./fok-exact-boundaries.mjs";

const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");

it("preserves both normal enqueue branches and the complete success-reference implementation", () => {
  const source = read(entry.enqueueFile);
  const previousPrefix = entry.changes[0][1];
  const references = previousPrefix.slice(previousPrefix.indexOf("/** [A8 可证实] LoseOrder 用成功腿"));
  expect(source).toContain(references);
  const previousBranches = entry.changes[3][1].replaceAll("decision.side", "side");
  expect(source.slice(source.indexOf('  if (side === "B" && accountA)'))).toBe(previousBranches);
});

it("restores every refactor stage to the complete original committed module", () => {
  const previous = restoreArbMakeUpEnqueueSource(entry.file, read(entry.file), read);
  expect(restoreArbMakeUpEnqueueSource(entry.file, previous, read)).toBe(previous);
  expect(restoreArbMakeUpPolicySource(entry.file, read(entry.file), read))
    .toBe(gitSource(arbMakeUpPolicyExtraction.baseline, entry.file));
});

it("preserves the public success-reference export and rejects changed dispatch", () => {
  const source = read(entry.file);
  expect(source).toContain('export { resolveArbMakeUpSuccessRef } from "@/stores/betting/autoBet/arbMakeUpEnqueue";');
  const changed = source.replace("}, decision.side)", '}, "A")');
  expect(changed).not.toBe(source);
  expect(() => restoreArbMakeUpEnqueueSource(entry.file, changed, read)).toThrow();
});

it.each([
  source => source.replace("betMoney: successRef.betMoney", "betMoney: 999"),
  source => source.replace("if (account && isPendingConfirmVenueProvider", "if (account || isPendingConfirmVenueProvider"),
  source => source.replace("ownerUserId: legA.observation?.ownerUserId", "ownerUserId: undefined"),
  source => source + "\nvoid unexpectedEnqueue();\n",
])("rejects changes to the entire moved enqueue implementation", (alter) => {
  const source = read(entry.enqueueFile);
  expect(alter(source)).not.toBe(source);
  expect(() => restoreArbMakeUpPolicySource(entry.file, read(entry.file),
    file => file === entry.enqueueFile ? alter(source) : read(file))).toThrow(/complete extracted makeup enqueue/);
});

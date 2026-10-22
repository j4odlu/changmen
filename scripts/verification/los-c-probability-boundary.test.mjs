import fs from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { LOS_C_INCREMENTS, restoreLosCProbabilitySource, verifyLosCProbabilitySources } from "./los-c-probability-boundary.mjs";
const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
it.each(Object.entries(LOS_C_INCREMENTS.changes))("restores the complete source before LOS C/UI changes: %s", (file, entry) => {
  const restored = restoreLosCProbabilitySource(file, read(file));
  expect(createHash("sha256").update(restored).digest("hex")).toBe(entry.beforeSha);
  const mutation = `${read(file)}\nvoid unregisteredLosDispatch();\n`;
  expect(restoreLosCProbabilitySource(file, mutation)).toBe(mutation);
  expect(() => verifyLosCProbabilitySources(target => target === file ? mutation : read(target))).toThrow();
});

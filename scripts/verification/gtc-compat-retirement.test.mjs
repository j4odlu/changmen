import fs from "node:fs";
import { expect, it } from "vitest";
import { verifyGtcCompatibilityRetirement, retirementFiles, retiredHelpers, nativeOrdersPath, restoreRetiredOrdersCompatibility } from "./gtc-compat-retirement.mjs";
const read = file => fs.readFileSync(file, "utf8");
it("removes all three runtime switches and validates every complete module against the fixed before source", () => expect(verifyGtcCompatibilityRetirement().switchesRemoved).toBe(3));
it("a fresh Windows CRLF checkout retains the complete fixed-source proof", () => {
  const windows = file => read(file).replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
  expect(verifyGtcCompatibilityRetirement(windows).files).toBe(41);
  expect(() => restoreRetiredOrdersCompatibility("server/db/rds/orders_store.js", windows("server/db/rds/orders_store.js"), windows)).not.toThrow();
});
it("physical EOL normalization cannot conceal escaped SQL characters or changed SQL contents", () => {
  const file = "server/db/rds/orders_store.js";
  const altered = read(file).replace("WHEN ${p}provider", "WHEN \\r\\n ${p}provider");
  expect(altered).not.toBe(read(file));
  expect(() => verifyGtcCompatibilityRetirement(target => target === file ? altered : read(target))).toThrow("complete native retirement boundary");
});
for (const file of retirementFiles().filter(file => !retiredHelpers.includes(file))) {
  it(`${file}: extra work cannot hide behind the retirement`, () => expect(() => verifyGtcCompatibilityRetirement(target => target === file ? `${read(target)}\nvoid unexpectedTrade();` : read(target))).toThrow(/complete native retirement boundary|complete source outside reject display change/));
}
it.each([
  source => source.replace('const table = "orders";', 'const table = "public.orders_financial";'),
  source => source.replace('"execution_record",', ''),
  source => `${source}\nvoid unexpectedTrade();`,
])("the native helper preserves both SQL identity and complete hook filtering", change => {
  const source = read(nativeOrdersPath), altered = change(source); expect(altered).not.toBe(source);
  expect(() => verifyGtcCompatibilityRetirement(file => file === nativeOrdersPath ? altered : read(file))).toThrow("complete native orders helper");
});
it("standalone restoration rejects an altered ordinary writer before any historical normalization", () => {
  const file = "server/db/rds/orders_store.js", source = read(file);
  expect(() => restoreRetiredOrdersCompatibility(file, `${source}\nvoid unexpectedTrade();`, read)).toThrow("complete native module after retirement");
});

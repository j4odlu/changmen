import fs from "node:fs";
import { test, expect } from "vitest";
import { restorePmSharedStreamSource, verifyPmSharedStreamContract } from "./pm-shared-stream-boundary.mjs";
const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const { changes } = JSON.parse(read("scripts/verification/pm-shared-stream-increments.json"));
test("passive stream hooks restore the full original PM-M implementation", () => {
  expect(() => verifyPmSharedStreamContract(read)).not.toThrow();
});
for (const [file, row] of Object.entries(changes)) {
  test("rejects original transport modification " + file, () => {
    expect(() => restorePmSharedStreamSource(file, read(file).replace("WS_RECONNECT_MS = 5_000", "WS_RECONNECT_MS = 1_000"), true)).toThrow();
  });
  test.each(row.increments.map((entry, index) => [index, entry[1]]))("rejects tampered or duplicated passive hook %s", (_index, after) => {
    expect(() => restorePmSharedStreamSource(file, read(file).replace(after, after + after), true)).toThrow();
    expect(() => restorePmSharedStreamSource(file, read(file).replace(after, after + "\nthrow new Error('tamper');"), true)).toThrow();
  });
}

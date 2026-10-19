import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import fs from "node:fs";
import { test, expect } from "vitest";
import { restorePmSharedStreamSource, verifyPmSharedStreamContract } from "./pm-shared-stream-boundary.mjs";
import { restoreVenueBrowserStream } from "./venue-browser-stream.mjs";
import { restoreVenueBrowserLifecycle } from "./venue-browser-lifecycle.mjs";
const read = withAdapterHistoryReader(file => readAdapterHistory(file, "utf8").replaceAll("\r\n", "\n"));
const { changes } = JSON.parse(read("scripts/verification/pm-shared-stream-increments.json"));
test("passive stream hooks restore the full original PM-M implementation", () => {
  expect(() => verifyPmSharedStreamContract(read)).not.toThrow();
});
for (const [file, row] of Object.entries(changes)) {
  test("rejects original transport modification " + file, () => {
    const source = restoreVenueBrowserLifecycle(file, read(file));
    expect(source).toContain("WS_RECONNECT_MS = 5_000");
    expect(() => restorePmSharedStreamSource(file, source.replace("WS_RECONNECT_MS = 5_000", "WS_RECONNECT_MS = 1_000"), true)).toThrow();
  });
  test.each(row.increments.map((entry, index) => [index, entry[1]]))("rejects tampered or duplicated passive hook %s", (_index, after) => {
    const previous = restoreVenueBrowserStream(file, read(file));
    expect(previous).toContain(after);
    expect(() => restorePmSharedStreamSource(file, previous.replace(after, after + after), true)).toThrow();
    expect(() => restorePmSharedStreamSource(file, previous.replace(after, after + "\nthrow new Error('tamper');"), true)).toThrow();
  });
}

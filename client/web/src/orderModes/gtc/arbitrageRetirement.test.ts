import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/** [changmen 扩展] 自动套利不得重新依赖 GTC 执行、历史恢复或双腿许可。 */
it("keeps the automatic arbitrage runtime independent of GTC execution", () => {
  const root = fileURLToPath(new URL("../../stores/betting/autoBet/", import.meta.url));
  const sources = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sources(file) : entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [file] : [];
  });
  for (const file of sources(root)) {
    const source = readFileSync(file, "utf8");
    expect(source, file).not.toMatch(/orderModes\/gtc|originalExecution|OriginalExecutionLifecycle|pmOrderMode/);
  }
  expect(existsSync(new URL("./arbLeg.ts", import.meta.url))).toBe(false);
  expect(existsSync(new URL("./selectionHistory.ts", import.meta.url))).toBe(false);
});

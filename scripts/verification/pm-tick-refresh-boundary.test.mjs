import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { expect, it } from "vitest";
import { restorePmTickRefreshSource } from "./pm-tick-refresh-boundary.mjs";
import { rebasePmFokImports } from "./pm-fok-source-relocation.mjs";
import { restorePmSharedStreamSource } from "./pm-shared-stream-boundary.mjs";
import { readVenueBrowserStateSource } from "./venue-browser-state.mjs";

const files = ["packages/venue-adapter/polymarket/quotes/pmTickMetadata.ts", "client/web/src/runtime/pmTickBufferQuotes.ts",
  "packages/venue-adapter/polymarket/quotes/pmTickState.ts", "packages/venue-adapter/polymarket/realtime/ws.ts",
  "packages/venue-adapter/polymarket/realtime/sportMarketWs.ts"];
for (const file of files) {
  it(`${file}: restores only the authorized tick refresh delta`, () => {
    const source = restorePmSharedStreamSource(file, readVenueBrowserStateSource(file, fs.readFileSync(file, "utf8")));
    const originalFile = file.replace("/quotes/", "/").replace("/realtime/", "/");
    const original = execFileSync("git", ["show", `e901bb596952256284cd8a9eb8b73b572c963915:${originalFile}`], { encoding: "utf8" }).replace(/\r\n/g, "\n");
    expect(rebasePmFokImports(restorePmTickRefreshSource(file, source), file, originalFile)).toBe(original);
    const marker = source.includes("fetchPmTickBufferTickSize") ? "fetchPmTickBufferTickSize" : "notePmTickReconnect";
    expect(() => restorePmTickRefreshSource(file, source.replace(marker, "wrongTickRefresh"))).toThrow("exact tick-size refresh change");
    expect(rebasePmFokImports(restorePmTickRefreshSource(file, `${source}\nthrow Error('unexpected');\n`), file, originalFile)).not.toBe(original);
  });
}
it("does not exempt precheck, transport or unrelated modules", () => {
  for (const file of ["packages/venue-adapter/polymarket/fok/bet.ts", "packages/venue-adapter/polymarket/transport/pmTransport.ts"])
    expect(restorePmTickRefreshSource(file, "changed execution\n")).toBe("changed execution\n");
});

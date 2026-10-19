import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import fs from "node:fs";
import { expect, it } from "vitest";
import { gitSource } from "./fok-exact-boundaries.mjs";
import { restorePmSportsTypeScriptSource as restore } from "./pm-sports-typescript-boundary.mjs";
for (const name of ["index", "gamma_poll", "sport_state", "parse_sport"]) {
  const file = `server/collectors/polymarket-sports/${name}.js`;
  const source = readAdapterHistory(file, "utf8").replaceAll("\r\n", "\n");
  const typed = readAdapterHistory(file.replace(/\.js$/, ".ts"), "utf8");
  const previous = gitSource("84364793171244eca85378ef7bce3388f147b237", file);
  it(`${name} restores the complete unchanged implementation and rejects any added runtime`, () => {
    expect(restore(file, source)).toBe(previous);
    expect(restore(file, previous)).toBe(previous);
    expect(() => restore(file, source, typed + "\nconsole.log('unreviewed');")).toThrow("complete runtime implementation");
    expect(() => restore(file, source + "\n", typed)).toThrow("exact compatibility entry");
    expect(() => restore(file, source.replace(".ts", ".js"), typed)).toThrow("exact compatibility entry");
  });
  if (name === "parse_sport") it("rejects a changed zero clock conversion", () => {
    const changed = typed.replace("msg.elapsed != null", "Boolean(msg.elapsed)");
    expect(changed).not.toBe(typed);
    expect(() => restore(file, source, changed)).toThrow("complete runtime implementation");
  });
  if (name === "sport_state") it("rejects a changed WS ownership rule", () => {
    const changed = typed.replace('source === "gamma"', 'source === "ws"');
    expect(changed).not.toBe(typed);
    expect(() => restore(file, source, changed)).toThrow("complete runtime implementation");
  });
}

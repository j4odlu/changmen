// [changmen 扩展] Native Node regression plus exact restoration of the original
// protected module; no business-source or directory exclusion is introduced.
import { readClientPackageSource } from "./client-package-relocation.mjs";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { gitSource, replaceExact, verifyProtectedSource } from "./fok-exact-boundaries.mjs";
import { restoreClientCoreNodeEnv } from "./client-core-node-env-boundary.mjs";

const file = "packages/client-core/src/shared/hkRelayOrigin.ts";
const source = readClientPackageSource(file, fs.readFileSync(file, "utf8"), f => fs.readFileSync(f, "utf8")).replaceAll("\r\n", "\n");
const original = gitSource("75b1efac66625e5f2bc9884a965b244bfaf337ed", file);

it("native Node resolves both relay origins without import.meta.env", () => {
  const url = new URL(`../../${file}`, import.meta.url).href;
  const script = `import {resolveHkRelayHttpOrigin,resolveMarketHubHttpOrigin} from ${JSON.stringify(url)};
    console.log(JSON.stringify([resolveHkRelayHttpOrigin(),resolveMarketHubHttpOrigin()]));`;
  const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", windowsHide: true }));
  const origin = `http://127.0.0.1:${process.platform === "win32" ? 3700 : 3456}`;
  expect(result).toEqual([origin, origin]);
});

it("restores the complete fixed original module and accepts its historical form", () => {
  expect(restoreClientCoreNodeEnv(file, source, replaceExact)).toBe(original);
  expect(restoreClientCoreNodeEnv(file, original, replaceExact)).toBe(original);
  expect(verifyProtectedSource(file, source, original)).toMatchObject({ fixedSourceEqual: false, exactBoundaryVerified: true });
});

it("direct whole-module verification treats CRLF and LF equally and still rejects changed CRLF source", () => {
  expect(verifyProtectedSource(file, source.replaceAll("\n", "\r\n"), original))
    .toEqual(verifyProtectedSource(file, source, original));
  const changed = source.replace("3700", "3701").replaceAll("\n", "\r\n");
  expect(() => verifyProtectedSource(file, changed, original)).toThrow();
});

for (const [label, mutate] of [
  ["changed backend port", value => value.replace("3700", "3701")],
  ["changed production hub", value => value.replace("https://ws.changmen.fun", "https://unreviewed.invalid")],
  ["extra runtime code", value => value + "\nthrow Error('unreviewed');\n"],
  ["different env fallback", value => value.replace("import.meta.env ?? {}", "import.meta.env ?? process.env")],
]) it(`still rejects ${label} through the fixed whole-module comparison`, () => {
  const changed = mutate(source);
  expect(changed).not.toBe(source);
  expect(() => verifyProtectedSource(file, changed, original)).toThrow();
});

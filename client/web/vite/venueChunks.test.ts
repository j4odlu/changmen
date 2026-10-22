import { rollup } from "rollup";
import { expect, it } from "vitest";
import { acyclicChunks } from "./plugins/acyclicChunks";
import { venueManualChunk } from "./venueChunks";

const root = "/fixture/client/packages/venue-browser/";
it.each([
  ["shared/changmenAuthToken.ts", "venue-shared"],
  ["contract/index.ts", "venue-shared"],
  ["adapter/shared/changmenAuthToken.ts", "venue-shared"],
  ["adapter/contract/index.ts", "venue-shared"],
  ["polymarket/auth/l2Auth.ts", "venue-polymarket"],
  ["adapter/polymarket/auth/l2Auth.ts", "venue-polymarket"],
  ["adapter/predictfun/bet.ts", "venue-predictfun"],
  ["adapter/registry/index.ts", undefined],
  ["adapter/adaptation/index.ts", undefined],
  ["pm-book-diagnostics/marketData.worker.ts", undefined],
  ["node_modules/ethers/lib.esm/index.js", undefined],
])("assigns %s consistently on Windows and POSIX", (relative, expected) => {
  const id = root + relative;
  expect(venueManualChunk(id)).toBe(expected);
  expect(venueManualChunk(id.replace(/\//g, "\\"))).toBe(expected);
});

it.each([
  "/fixture/client/packages/client-core/src/shared/http.ts",
  "/fixture/client/packages/arb-core/src/index.ts",
  "/fixture/packages/shared/odds_format.ts",
  "/fixture/packages/api-contract/index.ts",
  "/fixture/node_modules/@changmen/client-core/shared/http.ts",
  "/fixture/node_modules/socket.io-client/build/esm/index.js",
  "/fixture/client/web/node_modules/engine.io-client/build/esm/index.js",
  "/fixture/node_modules/socket.io-parser/build/esm/index.js",
])("keeps shared workspace and socket dependencies shared: %s", id => {
  expect(venueManualChunk(id)).toBe("venue-shared");
  expect(venueManualChunk(id.replace(/\//g, "\\"))).toBe("venue-shared");
});

const entry = "/fixture/entry.js";
const pm = root + "adapter/polymarket/index.ts";
const pmAuth = root + "adapter/polymarket/auth/l2Auth.ts";
const runtime = root + "polymarket/api.ts";
const pf = root + "adapter/predictfun/index.ts";
const shared = root + "adapter/shared/index.ts";
const auth = root + "shared/changmenAuthToken.ts";
const fixture: Record<string, string> = {
  [entry]: `import { pm, credential } from '${pm}'; import { pf } from '${pf}'; globalThis.result = [pm(), pf(), credential];`,
  [pm]: `export { credential } from '${pmAuth}'; export { pm } from '${runtime}';`,
  [pmAuth]: `export { token as credential } from '${auth}';`,
  [runtime]: `import { read } from '${shared}'; import { token } from '${auth}'; export function pm() { return read() + token; }`,
  [pf]: `import { read } from '${shared}'; export function pf() { return read(); }`,
  [shared]: `import { token } from '${auth}'; export function read() { return token; }`,
  [auth]: "export const token = 'fixture';",
};

async function generateFixture(manualChunks = venueManualChunk) {
  const bundle = await rollup({
    input: entry,
    onwarn() {},
    plugins: [{
      name: "migration-fixture",
      resolveId: id => Object.hasOwn(fixture, id) ? id : null,
      load: id => fixture[id],
    }, acyclicChunks()],
  });
  try {
    return await bundle.generate({ format: "es", manualChunks });
  }
  finally {
    await bundle.close();
  }
}

it("builds the migrated auth implementation and compatibility entry without a reverse venue dependency", async () => {
  const { output } = await generateFixture();
  const chunks = output.filter(item => item.type === "chunk");
  const sharedChunk = chunks.find(chunk => chunk.name === "venue-shared")!;
  expect(sharedChunk.modules).toHaveProperty(auth);
  expect(sharedChunk.imports).toEqual([]);
  for (const name of ["venue-polymarket", "venue-predictfun"]) {
    const chunk = chunks.find(item => item.name === name)!;
    expect(chunk.imports).toContain(sharedChunk.fileName);
  }
});

it("rejects a build if a future migration omits the shared implementation again", async () => {
  await expect(generateFixture(id => id === auth ? undefined : venueManualChunk(id)))
    .rejects.toThrow(/Circular chunk imports:.*venue-/);
});

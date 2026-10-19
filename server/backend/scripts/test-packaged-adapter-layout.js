import fs from "node:fs";
import path from "node:path";
import { syncPlatformAdapterBackendBundle } from "@changmen/venue-adapter-tools/sync-backend-bundle.mjs";
import { syncPlatformNodeBundle } from "../../platform-probes/scripts/sync-backend-bundle.mjs";

const adapterDst = syncPlatformAdapterBackendBundle();
const nodeDst = syncPlatformNodeBundle();

process.env.GAMEBET_ADAPTER_ROOT = adapterDst;
process.env.GAMEBET_NODE_ROOT = nodeDst;

const {
  getAdapterRoot,
  adapterRequire,
  initAdapterRegistry,
  initEsmPlatformBackends,
  requirePlatform,
  reqS,
  resetAdapterRootForTests,
} = await import("../core/shared/adapter_paths.js");

resetAdapterRootForTests();
process.env.GAMEBET_ADAPTER_ROOT = adapterDst;
process.env.GAMEBET_NODE_ROOT = nodeDst;
await initAdapterRegistry();
await initEsmPlatformBackends();

console.log("packaged adapter:", getAdapterRoot());
if (path.resolve(getAdapterRoot()) !== path.resolve(adapterDst)) {
  throw new Error(`expected packaged adapter ${adapterDst}, got ${getAdapterRoot()}`);
}

adapterRequire("registry", "feeds.js");
requirePlatform("OB", "node", "session.js");
requirePlatform("RAY", "node", "session.js");

const marketCatalog = reqS("catalog/market_catalog");
if (typeof marketCatalog.getDefaultMarketCode !== "function") {
  throw new TypeError("shared/catalog/market_catalog did not export getDefaultMarketCode");
}
console.log("shared resolve OK:", marketCatalog.getDefaultMarketCode("OB"));

console.log("packaged layout OK");

delete process.env.GAMEBET_ADAPTER_ROOT;
delete process.env.GAMEBET_NODE_ROOT;
fs.rmSync(adapterDst, { recursive: true, force: true });
fs.rmSync(nodeDst, { recursive: true, force: true });

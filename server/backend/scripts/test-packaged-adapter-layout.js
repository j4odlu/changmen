import fs from "node:fs";
import path from "node:path";
import { BACKEND_ROOT } from "@changmen/storage/paths";
import { syncPlatformAdapterBackendBundle } from "@changmen/venue-node/sync-backend-bundle.mjs";

const scratch = fs.mkdtempSync(path.join(BACKEND_ROOT, ".platform-layout-"));
const previous = Object.fromEntries(["GAMEBET_ADAPTER_ROOT", "GAMEBET_NODE_ROOT"].map(key => [key, process.env[key]]));
try {
  const adapterDst = syncPlatformAdapterBackendBundle({ dst: path.join(scratch, "runtime") });
  process.env.GAMEBET_ADAPTER_ROOT = adapterDst;
  process.env.GAMEBET_NODE_ROOT = adapterDst;
  const { getAdapterRoot, adapterRequire, initAdapterRegistry, initEsmPlatformBackends,
    requirePlatform, reqS, resetAdapterRootForTests } = await import("../core/shared/adapter_paths.js");
  resetAdapterRootForTests();
  await initAdapterRegistry();
  await initEsmPlatformBackends();
  if (path.resolve(getAdapterRoot()) !== path.resolve(adapterDst)) throw Error("Packaged runtime root mismatch");
  adapterRequire("registry", "feeds.js");
  for (const platform of ["OB", "RAY", "TF", "PB"]) requirePlatform(platform, "node", "session.js");
  if (fs.existsSync(path.join(adapterDst, "hg"))) throw Error("Optional HG probe must not enter the runtime bundle");
  requirePlatform("IA", "node", "collect_credentials.js");
  const catalog = reqS("catalog/market_catalog");
  if (typeof catalog.getDefaultMarketCode !== "function") throw TypeError("Shared catalog export missing");
  console.log("packaged runtime OK: platform modules load without a probe bundle");
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const target = path.resolve(scratch), parent = path.resolve(BACKEND_ROOT);
  if (path.dirname(target) !== parent || !path.basename(target).startsWith(".platform-layout-")) throw Error("Unexpected fixture cleanup target");
  fs.rmSync(target, { recursive: true, force: true });
}

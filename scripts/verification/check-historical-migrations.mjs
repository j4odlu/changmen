// Explicit offline audit only. Ordinary validation never imports this module.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectBackendProbeRelocation } from "./backend-probe-relocation.mjs";
import { inspectWorkspaceLayout } from "./workspace-layout-relocation.mjs";
import { inspectNodeResourceIsolation } from "./node-resource-isolation.mjs";
import { inspectNodeEntryRetirement } from "./node-entry-retirement.mjs";
import { inspectCatalogEnvironmentIsolation } from "./catalog-environment-isolation.mjs";
import { inspectClientPackageRelocation } from "./client-package-relocation.mjs";
import { inspectBackendToolRelocation } from "./backend-tool-relocation.mjs";
import { inspectAdapterBrowserRelocation } from "./adapter-browser-relocation.mjs";
import { inspectBrowserEntryRetirement } from "./browser-entry-retirement.mjs";
import { inspectNodePackageRelocation } from "./node-package-relocation.mjs";
import { inspectVenueBrowserRelocation } from "./venue-browser-relocation.mjs";
import { inspectRetainedSourceBoundaries } from "./retained-source-boundaries.mjs";
import { inspectFrontendBuildInputs } from "./frontend-build-inputs.mjs";

export function inspectHistoricalMigrations(root) {
  for (const inspect of [inspectCatalogEnvironmentIsolation, inspectNodeEntryRetirement,
    inspectNodeResourceIsolation, inspectBackendProbeRelocation, inspectBackendToolRelocation,
    inspectBrowserEntryRetirement, inspectAdapterBrowserRelocation, inspectVenueBrowserRelocation,
    inspectNodePackageRelocation, inspectClientPackageRelocation, inspectRetainedSourceBoundaries,
    inspectFrontendBuildInputs, inspectWorkspaceLayout]) {
    const report = inspect(root);
    if (report.violations?.length) throw Error(JSON.stringify(report.violations));
    console.log(`[historical-migrations] ${inspect.name}: PASS`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  inspectHistoricalMigrations(fileURLToPath(new URL("../../", import.meta.url)));

import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import fs from "node:fs";
import { expect, it } from "vitest";
import { restoreRaySubmissionPreviewSource, verifyRaySubmissionPreviewSources } from "./ray-submission-preview-boundary.mjs";
import { verifyRayClientMonitorSource } from "./ray-client-monitor-boundary.mjs";
import { restoreRayProviderSource } from "./ray-frontend-boundary.mjs";
const read = withAdapterHistoryReader(file => readAdapterHistory(file, "utf8"));

it("preserves the original complete monitor hash and provider after restoring only exact preview additions", () => {
  expect(() => verifyRaySubmissionPreviewSources(read)).not.toThrow();
  const monitor = "client/web/src/runtime/rayOrderMonitor/runtime.ts";
  expect(verifyRayClientMonitorSource(monitor, read(monitor))).toBe(true);
  const source = read(monitor);
  expect(() => verifyRayClientMonitorSource(monitor, source.replace("polling.has(player) || account.active", "polling.has(player)"))).toThrow();
  expect(() => verifyRayClientMonitorSource(monitor, source.replace("observeRayOrderContexts(player, contextOrders, current)", "observeRayOrderContexts(player, orders, current)"))).toThrow();
  const provider = "client/web/src/runtime/providers.ts";
  expect(() => restoreRayProviderSource(provider, read(provider), read)).not.toThrow();
  expect(() => restoreRayProviderSource(provider, read(provider).replace('account.provider !== "RAY"', 'account.provider !== "OB"'), read)).toThrow();
});

it("rejects edits to read-only behavior and exact preview entry points without changing immutable baselines", () => {
  expect(() => verifyRaySubmissionPreviewSources(file => read(file) + (file.endsWith("submissionPreview.ts") ? "\nvoid writeOrders();" : ""))).toThrow();
  const file = "client/web/src/runtime/rayOrderMonitor/runtime.ts";
  expect(() => restoreRaySubmissionPreviewSource(file, read(file).replace("startRaySubmissionPreviewPolling();", ""))).toThrow();
  expect(() => verifyRaySubmissionPreviewSources(file => file.endsWith("submissionPreviewPolling.ts")
    ? read(file).replace('from "@/runtime/venueAdapters"', 'from "@/runtime/providers"') : read(file))).toThrow();
});

it("keeps the preview independent of A/B rejection results and protects the confirming label", () => {
  const file = "client/web/src/stores/betting/autoBet/phases/finalizeArbBet.ts";
  expect(read(file)).not.toContain("submissionPreview");
  expect(read("client/web/src/runtime/rayOrderMonitor/submissionPreview.ts")).not.toContain("ArbBetPlaced");
  expect(() => verifyRaySubmissionPreviewSources(path => path.endsWith("submissionPreview.ts")
    ? read(path).replace('Status: "RayConfirming"', 'Status: "None"') : read(path))).toThrow();
});

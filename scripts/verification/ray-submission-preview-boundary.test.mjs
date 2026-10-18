import fs from "node:fs";
import { expect, it } from "vitest";
import { restoreRaySubmissionPreviewSource, verifyRaySubmissionPreviewSources } from "./ray-submission-preview-boundary.mjs";
import { verifyRayClientMonitorSource } from "./ray-client-monitor-boundary.mjs";
import { restoreRayProviderSource } from "./ray-frontend-boundary.mjs";
const read = file => fs.readFileSync(file, "utf8");

it("preserves the original complete monitor hash and provider after restoring only exact preview additions", () => {
  expect(() => verifyRaySubmissionPreviewSources(read)).not.toThrow();
  const monitor = "client/web/src/runtime/rayOrderMonitor/runtime.ts";
  expect(verifyRayClientMonitorSource(monitor, read(monitor))).toBe(true);
  const source = read(monitor);
  expect(() => verifyRayClientMonitorSource(monitor, source.replace("if (!current() || account.active)", "if (!current())"))).toThrow();
  expect(() => verifyRayClientMonitorSource(monitor, source.replace("observeRayOrderContexts(player, contextOrders, current)", "observeRayOrderContexts(player, orders, current)"))).toThrow();
  const provider = "client/web/src/runtime/providers.ts";
  expect(() => restoreRayProviderSource(provider, read(provider), read)).not.toThrow();
  expect(() => restoreRayProviderSource(provider, read(provider).replace('account.provider !== "RAY"', 'account.provider !== "OB"'), read)).toThrow();
});

it("rejects edits to read-only behavior and exact preview entry points without changing immutable baselines", () => {
  expect(() => verifyRaySubmissionPreviewSources(file => read(file) + (file.endsWith("submissionPreview.ts") ? "\nvoid writeOrders();" : ""))).toThrow();
  const file = "client/web/src/runtime/rayOrderMonitor/runtime.ts";
  expect(() => restoreRaySubmissionPreviewSource(file, read(file).replace("observeRaySubmissionPreviews(account, orders, startedAt)", "observeRaySubmissionPreviews(account, [], startedAt)"))).toThrow();
});

it("requires the display-only handoff after the original rejection check and rejects changed results", () => {
  const file = "client/web/src/stores/betting/autoBet/phases/finalizeArbBet.ts";
  expect(() => verifyRaySubmissionPreviewSources(path => path === file
    ? read(path).replace("finishRaySubmissionPreviewChecks(placed, settle);", "finishRaySubmissionPreviewChecks(placed, {});") : read(path))).toThrow();
  expect(() => verifyRaySubmissionPreviewSources(path => path === file
    ? read(path).replaceAll("finishRaySubmissionPreviewChecks", "removedDisplayHandoff") : read(path))).toThrow();
});

import { defineConfig } from "vitest/config";
export default defineConfig({ test: {
  include: ["docs/audits/2026-11-07-pm-sdk-evaluation/sdk-evaluation.test.mjs"],
  environment: "node", maxWorkers: 1,
} });

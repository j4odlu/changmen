import { defineConfig } from "vitest/config";
export default defineConfig({test:{include:["scripts/migrations/pm-orders-minimal/postgres.integration.mjs"],fileParallelism:false,maxWorkers:1,testTimeout:15000,hookTimeout:20000}});

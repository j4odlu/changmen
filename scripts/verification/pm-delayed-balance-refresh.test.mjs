import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { PM_DELAYED_BALANCE_REFRESH, restorePmDelayedBalanceRefreshSource, verifyPmDelayedBalanceRefreshSource } from "./pm-delayed-balance-refresh.mjs";
import { restorePmBalanceCredentialsSource, verifyPmBalanceCredentialsSources } from "./pm-balance-credentials-boundary.mjs";
import { historicalWorkspaceFs } from "./workspace-layout-history.mjs";

const read = file => fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const row = PM_DELAYED_BALANCE_REFRESH;
it("restores the complete previous source through direct and historical readers", () => {
  const before = execFileSync("git", ["show", `${row.baseline}:${row.file}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
  expect(restorePmDelayedBalanceRefreshSource(row.file, read(row.file))).toBe(before);
  expect(restorePmDelayedBalanceRefreshSource(row.file, read(row.file).replaceAll("\n", "\r\n"))).toBe(before);
  expect(restorePmBalanceCredentialsSource(row.file, read(row.file))).toBe(before);
  expect(historicalWorkspaceFs.readFileSync(row.file, "utf8")).toBe(before);
});
it("rejects unrelated changes rather than concealing them from historical checks", () => {
  const changed = read(row.file).replace("&& !synced.pendingConfirm", "&& synced.pendingConfirm");
  expect(restorePmDelayedBalanceRefreshSource(row.file, changed)).toBe(changed);
  expect(restorePmBalanceCredentialsSource(row.file, changed)).toBe(changed);
  expect(() => verifyPmDelayedBalanceRefreshSource(() => changed)).toThrow("Unregistered delayed balance refresh change");
  expect(() => verifyPmBalanceCredentialsSources(file => file === row.file ? changed : read(file))).toThrow("Unregistered delayed balance refresh change");
});
it("verifies the registered repair", () => expect(() => verifyPmDelayedBalanceRefreshSource()).not.toThrow());

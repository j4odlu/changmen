import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { moduleTokens } from "./fok-exact-boundaries.mjs";
import { rayMonitorReviewedCommit, restoreRayOrderMonitorSource } from "./ray-order-monitor-boundary.mjs";
import { restoreRetiredOrdersCompatibility } from "./gtc-compat-retirement.mjs";

const path = "server/db/rds/orders_store.js";
const git = ref => execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
const reviewed = git(rayMonitorReviewedCommit);
describe("exact RAY monitoring extensions retain whole FOK source protection", () => {
  it("restores the complete parent module with its original 33 financial references", () => {
    const restored = restoreRayOrderMonitorSource(reviewed);
    expect(moduleTokens(restored)).toEqual(moduleTokens(git(`${rayMonitorReviewedCommit}^`)));
    const relation = `\${financialOrdersRelation()}`;
    expect(restored.split(relation).length - 1).toBe(33);
    expect(reviewed.split(relation).length - 1).toBe(34);
  });
  it("current RAY extensions retain the reviewed complete implementations", () => {
    expect(() => restoreRayOrderMonitorSource(restoreRetiredOrdersCompatibility(path, readAdapterHistory(path, "utf8")))).not.toThrow();
  });
  it.each([
    ["reader owner", "WHERE user_id = $1 AND player_id = $2 AND provider = 'RAY'", "WHERE player_id = $2 AND provider = 'RAY'"],
    ["reader provider", "AND provider = 'RAY'", "AND provider IN ('RAY','Polymarket')"],
    ["reader terminal gate", "AND (lower(coalesce(status, 'none')) NOT IN", "AND (lower(coalesce(status, 'none')) IN"],
    ["reader entry condition", "Array.isArray(opts?.rayMonitorOrderIds)", "true || Array.isArray(opts?.rayMonitorOrderIds)"],
    ["writer owner", "o.user_id=t.user_id AND o.player_id=t.player_id", "o.player_id=t.player_id"],
    ["writer terminal gate", "AND lower(coalesce(o.status,'none')) NOT IN", "AND lower(coalesce(o.status,'none')) IN"],
    ["writer financial gate", "\"AND o.financial_ready\"", "\"AND true\""],
    ["writer upsert", "UPDATE orders AS o SET", "INSERT INTO orders AS o SET"],
    ["writer deleted original", "o.order_id=t.order_id", "true"],
    ["writer identity leak", "'pmGtcExecutionId','pmGtcRevision'", "'other','pmGtcRevision'"],
  ])("rejects changes to the full reviewed %s", (_, before, after) => {
    expect(reviewed).toContain(before);
    expect(() => restoreRayOrderMonitorSource(reviewed.replace(before, after))).toThrow("complete reviewed RAY monitoring");
  });
  it("rejects duplicate writer definitions or duplicate recovery gates", () => {
    expect(() => restoreRayOrderMonitorSource(`${reviewed}\nexport async function patchRayMonitorOrders(rows) {}\n`)).toThrow("exactly one reviewed");
    const duplicate = reviewed.replace("const since = Number(opts?.sinceCreateAt);", "if (Array.isArray(opts?.rayMonitorOrderIds)) return [];\n  const since = Number(opts?.sinceCreateAt);");
    expect(() => restoreRayOrderMonitorSource(duplicate)).toThrow("exactly one reviewed RAY monitoring recovery branch");
  });
  it("additional calls and ordinary reader changes remain visible to the complete module comparison", () => {
    const expected = moduleTokens(git(`${rayMonitorReviewedCommit}^`));
    const extra = restoreRayOrderMonitorSource(`${reviewed}\nvoid patchRayMonitorOrders([]);\n`);
    expect(moduleTokens(extra)).not.toEqual(expected);
    const changed = reviewed.replace("const useSince = Number.isFinite(since) && since > 0;", "const useSince = true;");
    expect(moduleTokens(restoreRayOrderMonitorSource(changed))).not.toEqual(expected);
  });
});

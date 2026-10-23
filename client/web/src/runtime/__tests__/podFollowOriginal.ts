import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { PodFollowAutoRunnerContext } from "../podFollowAutoRunner";

const panel = execFileSync("git", ["show", "21e45cdee305f3e2ce44b8f475803ef0b0fc8324:client/web/src/components/football/PodFollowPanel.vue"],
  { encoding: "utf8", windowsHide: true }).replaceAll("\r\n", "\n");
if (createHash("sha256").update(panel).digest("hex") !== "fb3a86abbac65c5a0972acb0255ef3acefc7cc014c84ef18c6c9395d3b1f05a0")
  throw new Error("Original POD panel baseline changed");
const source = panel.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1];
export const originalPodPanel = panel;
const tree = ts.createSourceFile("original-panel.ts", source, ts.ScriptTarget.Latest, true);
export const originalPodFunctions = new Map(tree.statements.filter(ts.isFunctionDeclaration)
  .map(node => [node.name!.text, node.getText(tree)]));

export function executablePodSource(source: string): string {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true } }).outputText;
}

/** The actual old runner, with the same injected state and dependencies as the extraction. */
export function createOriginalPodRunner(ctx: PodFollowAutoRunnerContext, dependencies: Record<string, unknown>): {
  requestAutoPlace: () => void;
  restoreAutoPlaceState: () => Promise<void>;
  start: () => void;
  stop: () => void;
  cancelPending: () => void;
} {
  const bindings = { ...ctx, ...ctx.payloads, ...ctx.gates, ...ctx.placement, ...dependencies };
  const functions = ["maybeAutoPlace", "requestAutoPlace", "drainAutoPlaceQueue", "restoreAutoPlaceState"]
    .map(name => executablePodSource(originalPodFunctions.get(name)!)).join("\n");
  const factory = runInNewContext(`(${Object.keys(bindings).join(",")}) => {
    let autoRunnerActive = false, autoRunRequested = false, autoRunnerStopped = false;
    ${functions}
    return { requestAutoPlace, restoreAutoPlaceState,
      start: () => { autoRunnerStopped = false; },
      stop: () => { autoRunnerStopped = true; autoRunRequested = false; },
      cancelPending: () => { autoRunRequested = false; } };
  }`);
  return factory(...Object.values(bindings));
}

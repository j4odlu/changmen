import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import { executablePodSource, originalPodFunctions, originalPodPanel } from "./__tests__/podFollowOriginal";

const modules = {
  "podFollowPayload": [
    "followStakeFor",
    "strategyStakeFor",
    "ticketPlacePayload",
    "pmTicketPlacePayload",
    "rayTicketPlacePayload"
  ],
  "podFollowOrderGate": [
    "venuePlaceKey",
    "orderCreateMs",
    "isTodayOrderRow",
    "rayUnifiedFootballRows",
    "rayPendingTasks",
    "rayPendingPlacedIds",
    "rayPendingPlacedEntries",
    "rayPlaceBlock",
    "pmUnifiedFootballRows",
    "pmPodClientId",
    "isPmUnifiedPodPlaced",
    "pmUnifiedOrderKey",
    "pmUnifiedPendingCap",
    "hasVenueOrder",
    "venueOrderCountToday",
    "venueDailyOrderLimit",
    "venueSelectedAccountCount",
    "venueNextOrderCount",
    "venueDailyOrderBlock",
    "isVenuePlaced",
    "placeBlock",
    "pmPlaceBlock",
    "pendingCap",
    "rayOrderExchange",
    "pendingPlacedIds",
    "pendingPmPlacedIds",
    "pendingPlacedEntries",
    "inferPmMarketCode",
    "inferPmBoardSide",
    "pmGateEntryFromPayload",
    "pendingPmPlacedEntries"
  ],
  "podFollowPlacement": [
    "placeTicket",
    "placePmTicket",
    "placeRayTicket",
    "recordObAttempt"
  ],
  "podFollowAutoRunner": [
    "maybeAutoPlace",
    "requestAutoPlace",
    "drainAutoPlaceQueue",
    "restoreAutoPlaceState"
  ]
};

function undoStopBoundary(name: string, source: string): string {
  if (!["maybeAutoPlace", "drainAutoPlaceQueue", "restoreAutoPlaceState"].includes(name)) return source;
  source = source.replace("    const epoch = generation;\n", "");
  if (name === "maybeAutoPlace") {
    source = source.replace("!isCurrent(epoch) || ", "").replace("    if (!isCurrent(epoch)) return attempted;\n", "");
    source = source.replace("!isCurrent(epoch) || ", "");
  } else if (name === "drainAutoPlaceQueue") {
    source = source.replace("autoRunRequested && isCurrent(epoch) &&", "autoRunRequested && !autoRunnerStopped &&")
      .replace("if (attempted && isCurrent(epoch))", "if (attempted)");
  } else {
    source = source.replaceAll("      if (!isCurrent(epoch)) return;\n", "")
      .replace("if (isCurrent(epoch)) autoReady.value = false;", "autoReady.value = false;");
  }
  return source;
}

it("preserves all 44 original function bodies except the explicit stop-generation guards", () => {
  let count = 0;
  for (const [module, names] of Object.entries(modules)) {
    const source = readFileSync(join(process.cwd(), "src/runtime", module + ".ts"), "utf8");
    const tree = ts.createSourceFile(module + ".ts", source, ts.ScriptTarget.Latest, true);
    const functions = new Map<string, string>();
    function visit(node: ts.Node) {
      if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(tree));
      ts.forEachChild(node, visit);
    }
    visit(tree);
    for (const name of names) {
      expect(executablePodSource(undoStopBoundary(name, functions.get(name)!)), name)
        .toBe(executablePodSource(originalPodFunctions.get(name)!));
      count++;
    }
  }
  expect(count).toBe(44);
});

it("preserves the remaining panel handlers, reactive watchers, lifecycle order and complete UI", () => {
  const panel = readFileSync(join(process.cwd(), "src/components/football/PodFollowPanel.vue"), "utf8").replaceAll("\r\n", "\n");
  const script = panel.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1];
  const tree = ts.createSourceFile("panel.ts", script, ts.ScriptTarget.Latest, true);
  const moved = new Set(Object.values(modules).flat());
  const remaining = tree.statements.filter(ts.isFunctionDeclaration);
  expect(remaining.map(node => node.name!.text).sort()).toEqual([...originalPodFunctions.keys()].filter(name => !moved.has(name)).sort());
  for (const node of remaining) {
    const source = node.getText(tree).replace("autoRunner.cancelPending();", "autoRunRequested = false;");
    expect(executablePodSource(source), node.name!.text).toBe(executablePodSource(originalPodFunctions.get(node.name!.text)!));
  }
  const hooks = (source: string) => {
    const ast = ts.createSourceFile("panel.ts", source, ts.ScriptTarget.Latest, true);
    return ast.statements.filter(ts.isExpressionStatement).map(node => node.getText(ast))
      .filter(text => /^(?:watch|onMounted|onUnmounted)\(/.test(text))
      .map(text => executablePodSource(text.replace("autoRunner.start();", "autoRunnerStopped = false;")
        .replace("autoRunner.stop();", "autoRunnerStopped = true;\nautoRunRequested = false;")));
  };
  expect(hooks(script)).toEqual(hooks(originalPodPanel.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]));
  const ui = (source: string) => source.slice(source.indexOf("</script>")).replace(/\n{3,}/g, "\n\n");
  expect(ui(panel)).toBe(ui(originalPodPanel));
});

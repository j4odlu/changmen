import { expect, test } from "vitest";
import ts from "typescript";
import { originalPendingGateway, pendingGroups, pendingHarness, readPending } from "./__tests__/pendingVenueOriginal";

const parse = (source: string) => ts.createSourceFile("module.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const functions = (source: string) => new Map(parse(source).statements.filter(ts.isFunctionDeclaration).map(n => [n.name!.text, n.getText()]));
const executable = (source: string) => ts.transpileModule(source.replace(/^export /m, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true },
}).outputText.trim();
const original = functions(originalPendingGateway);
for (const [module, names] of Object.entries(pendingGroups)) {
  test.each(names)(`${module}: %s retains its original complete executable body`, name => {
    const current = functions(readPending(module)).get(name)!;
    expect(current).toBeTruthy();
    const restored = current.replaceAll("pendingVenueConfirmationSession.paused", "pendingVenueConfirmationsPaused")
      .replaceAll("pendingVenueConfirmationSession.epoch", "pendingVenueConfirmationEpoch");
    expect(executable(restored)).toBe(executable(original.get(name)!));
  });
}
test("retains the task schema, every singleton collection initializer and public gateway exports", () => {
  const state = parse(readPending("pendingVenueConfirmationState"));
  const baseline = parse(originalPendingGateway);
  const variables = (tree: ts.SourceFile) => new Map(tree.statements.filter(ts.isVariableStatement)
    .flatMap(s => s.declarationList.declarations.map(d => [d.name.getText(), d.initializer!.getText()] as const)));
  const before = variables(baseline), after = variables(state);
  for (const [name, init] of after) {
    if (name === "pendingVenueConfirmationSession") {
      expect(init).toBe("{ paused: false, epoch: 0 }");
      expect(before.get("pendingVenueConfirmationsPaused")).toBe("false");
      expect(before.get("pendingVenueConfirmationEpoch")).toBe("0");
    }
    else expect(init).toBe(before.get(name));
  }
  const schema = (tree: ts.SourceFile) => tree.statements.filter(ts.isInterfaceDeclaration)
    .find(n => n.name.text === "PendingVenueBetConfirmation")!.getText().replace(/^export /, "");
  expect(schema(state)).toBe(schema(baseline));
  const exported = (source: string) => parse(source).statements.flatMap(n => ts.isExportDeclaration(n)
    && n.exportClause && ts.isNamedExports(n.exportClause) ? n.exportClause.elements.map(e => e.name.text)
    : ts.isFunctionDeclaration(n) && n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ? [n.name!.text] : []).sort();
  expect(exported(readPending("betGateway"))).toEqual(exported(originalPendingGateway));
});

const scenarios = ["pending-backoff", "filled", "reject", "confirm-error", "save-error", "duplicate", "write-barrier",
  "pause-resume-flight", "session-flight", "scope-flight", "account-removed", "rds", "rds-error", "journal", "storage-invalid"] as const;
test.each(["Polymarket", "PredictFun"].flatMap(provider => scenarios.map(scenario => ({ provider, scenario }))))(
  "$provider/$scenario matches the historical gateway's ordered effects, persisted tasks and timers", async ({ provider, scenario }) => {
    async function run(old: boolean) {
      const h = pendingHarness(old, provider, scenario === "storage-invalid" ? "not-json" : undefined);
      const { control, api, store } = h;
      if (scenario === "rds" || scenario === "rds-error") {
        control.rows = [{ orderId: "hash-one", submission: h.submission, matchId: "match", conditionId: "condition",
          tokenId: "token", target: "Home", odds: 2, linkId: 5 }];
        control.restoreError = scenario === "rds-error";
        api.resumePendingVenueConfirmations(store); await h.tick(5001);
        control.restoreError = false; control.outcome = "filled"; await h.tick(5001);
      }
      else if (scenario === "journal") {
        control.attempts = [{ orderHash: "hash-one", side: "BUY", makerAmount: "10000000", submittedAt: h.submission.submittedAt,
          recovery: { matchId: "match", venueBetId: "condition", itemId: "token", betRowId: 20, target: "Home", betMoney: 10, odds: 2 } }];
        api.resumePendingVenueConfirmations(store); await h.tick(1001);
        control.outcome = "filled"; await h.tick(2001);
      }
      else if (scenario.endsWith("flight")) {
        let finish!: () => void;
        control.confirmWait = new Promise<void>(resolve => { finish = resolve; });
        h.notify(); await h.flush();
        if (scenario === "pause-resume-flight") { api.pausePendingVenueConfirmations(); api.resumePendingVenueConfirmations(store); }
        else if (scenario === "session-flight") control.session = "two";
        else control.scope = "other-wallet";
        control.outcome = "filled"; finish(); await h.tick(0);
      }
      else if (scenario === "write-barrier") {
        let finish!: () => void;
        const write = new Promise<void>(resolve => { finish = resolve; });
        control.outcome = "filled"; h.notify(write); await h.flush();
        expect(h.log.some(row => row[0] === "save")).toBe(false);
        finish(); await h.tick(0);
      }
      else {
        if (scenario === "filled" || scenario === "save-error") control.outcome = "filled";
        if (scenario === "reject") control.outcome = "reject";
        if (scenario === "confirm-error") control.outcome = "throw";
        control.saveError = scenario === "save-error";
        h.notify();
        if (scenario === "duplicate") h.notify();
        await h.tick(0);
        if (scenario === "account-removed") control.accounts = [];
        await h.tick(63_001);
        if (scenario === "confirm-error" || scenario === "save-error") {
          control.outcome = "filled"; control.saveError = false; await h.tick(30_001);
        }
      }
      return h.snapshot();
    }
    const before = await run(true), after = await run(false);
    expect(after).toEqual(before);
    expect(after.log[0]).toEqual(["storage-read", "PENDING_VENUE_BET_CONFIRM"]);
    expect(after.log.filter((row: unknown[]) => row[0] === "storage-read")).toHaveLength(1);
  });

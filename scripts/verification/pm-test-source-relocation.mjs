import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";

// [changmen 扩展] 测试按功能迁移；保留测试断言、mock 的原模块目标和原加载形式。
const root = "packages/venue-adapter/polymarket";
export const PM_TEST_GROUPS = Object.freeze({
  transport: [
    "api.test.ts",
    "pmAutoTransport.test.ts",
    "pmPublicRoute.test.ts",
    "pmTransport.test.ts",
    "transport.test.ts",
  ],
  wallet: [
    "balance.test.ts",
    "depositWallet.test.ts",
    "pmWalletPrepSdk.test.ts",
    "relayer.test.ts",
    "relayerAuth.test.ts",
    "sessionBuilderConfig.test.ts",
  ],
  fok: [
    "bet.test.ts",
    "orderSettlement.fok.test.ts",
    "pmFokDepthBufferMode.test.ts",
    "settlementJob.test.ts",
  ],
  markets: [
    "collect.test.ts",
    "marketIndex.test.ts",
    "parse.test.ts",
    "pmFootballDiscovery.test.ts",
    "pmMapOutcomeStore.test.ts",
    "pmMarketGuard.test.ts",
    "pmSportGuard.test.ts",
  ],
  orders: [
    "confirmationTimeline.test.ts",
    "legOutcome.test.ts",
    "marketDelay.test.ts",
    "orderLookup.test.ts",
    "orders.test.ts",
    "orderStatus.test.ts",
    "pmActivity.test.ts",
    "pmActivityV2.live.test.ts",
    "pmActivityV2.test.ts",
    "pmClientApiPrepare.test.ts",
    "pmFee.test.ts",
    "pmHeartbeat.test.ts",
    "pmLogicalPosition.test.ts",
    "pmOrderSync.test.ts",
    "pmOrigin.test.ts",
    "pmPostFillOrder.test.ts",
    "pmSubmitResponse.test.ts",
    "pmTradeHashes.test.ts",
    "tradeFailure.test.ts",
  ],
  auth: [
    "credentials.test.ts",
    "profile.test.ts",
  ],
  compatibility: [
    "fokRelocation.test.ts",
    "functionalRelocation.test.ts",
  ],
  quotes: [
    "marketQuoteHub.lifecycle.test.ts",
    "pmArbPriceBufferMode.test.ts",
    "pmTickBuffer.test.ts",
    "pmTickPrice.test.ts",
    "pmTokenQuote.staleWs.test.ts",
    "priceQuote.test.ts",
    "sportQuoteHub.test.ts",
  ],
  diagnostics: [
    "orderTrace.test.ts",
    "pmExecutionMetrics.test.ts",
  ],
  submission: [
    "pmBetGuard.test.ts",
    "pmBrowserSubmitClock.test.ts",
    "pmDetection.test.ts",
    "pmManualSell.delayed.test.ts",
    "pmManualSell.execute.test.ts",
    "pmManualSell.final.test.ts",
    "pmManualSell.test.ts",
    "pmOrderClientCache.test.ts",
    "pmStake.test.ts",
    "pmSubmitJournal.test.ts",
  ],
  realtime: [
    "pmMarketWsMode.test.ts",
    "pmUserWsMode.test.ts",
    "sportMarketWs.test.ts",
    "sportWsConfig.test.ts",
    "userWs.test.ts",
    "userWsMessages.test.ts",
    "ws.test.ts",
    "wsConfig.test.ts",
  ],
});
for (const names of Object.values(PM_TEST_GROUPS)) Object.freeze(names);
export const PM_TEST_RELOCATIONS = Object.freeze(Object.fromEntries(
  Object.entries(PM_TEST_GROUPS).flatMap(([group, names]) => names.map(name => [
    `${root}/${name}`,
    `${root}/tests/${group}/${name}`,
  ])),
));

export function rebasePmTestImports(source, fromFile, toFile, redirects = {}) {
  const sf = ts.createSourceFile(fromFile, source, ts.ScriptTarget.Latest, true);
  assert.equal(sf.parseDiagnostics.length, 0, `${fromFile}: invalid TypeScript`);
  const edits = [];
  function visit(node) {
    if (ts.isStringLiteral(node) && node.text.startsWith(".")) {
      const p = node.parent;
      const mock = ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression)
        && p.expression.expression.getText(sf) === "vi"
        && ["mock", "doMock", "unmock", "doUnmock", "importActual", "importMock"].includes(p.expression.name.text)
        && p.arguments[0] === node;
      const module = ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node)
        || (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword && p.arguments[0] === node)
        || (ts.isLiteralTypeNode(p) && ts.isImportTypeNode(p.parent)) || mock;
      if (module) {
        let target = path.posix.resolve(path.posix.dirname(fromFile), node.text);
        const suffix = /\.(?:ts|js)$/.exec(target)?.[0] ?? "";
        const key = target.slice(0, suffix ? -suffix.length : undefined);
        const relocated = redirects[key];
        if (relocated)
          target = relocated + suffix;
        let relative = path.posix.relative(path.posix.resolve(path.posix.dirname(toFile)), target);
        if (!relative)
          relative = `../${path.posix.basename(target)}`;
        if (!relative.startsWith("."))
          relative = `./${relative}`;
        const start = node.getStart(sf) + 1; const end = node.getEnd() - 1;
        assert.equal(source.slice(start, end), node.text, "escaped module paths require explicit review");
        edits.push({ start, end, relative });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.relative + source.slice(edit.end);
  return source;
}

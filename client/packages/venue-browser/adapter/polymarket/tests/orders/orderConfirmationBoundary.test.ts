import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

it("exports the canonical confirmation modules and retains existing public function identities", async () => {
  const lookup = await import("@changmen/venue-browser/polymarket/orders/confirmation/tradeLookup");
  const fill = await import("@changmen/venue-browser/polymarket/orders/confirmation/fillResolution");
  const original = await import("@changmen/venue-browser/polymarket/orders/history/orders");
  expect(original.fetchPolymarketConfirmedTradeForOrder).toBe(lookup.fetchPolymarketConfirmedTradeForOrder);
  for (const name of ["resolvePolymarketBuyFill", "resolvePolymarketSellFill", "resolvePolymarketSellFillWithRetry", "POLYMARKET_SELL_FILL_RETRY_OPTS"] as const)
    expect(original[name]).toBe(fill[name]);
});

it("confirmation, FOK verification, recovery and manual sell never load the history synchronization host", () => {
  const root = fileURLToPath(new URL("../../../../polymarket/", import.meta.url));
  const seen = new Set<string>();
  const forbidden = /\/orders\/history\/(?:orders|pmStoredOrders|pmOrderSync|storedMarketRefresh|orderMarketReader)\.ts$/;
  function inspect(file: string) {
    file = path.resolve(file);
    expect(file.replaceAll("\\", "/")).not.toMatch(forbidden);
    if (seen.has(file)) return;
    seen.add(file);
    const tree = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function follow(specifier: ts.Expression) {
      expect(ts.isStringLiteral(specifier), "Runtime module paths must be statically inspectable").toBe(true);
      if (!ts.isStringLiteral(specifier)) return;
      const target = specifier.text;
      const resolved = target.startsWith(".") ? path.resolve(path.dirname(file), target)
        : target.startsWith("@changmen/venue-browser/polymarket/") ? path.resolve(root, target.slice("@changmen/venue-browser/polymarket/".length)) : null;
      if (!resolved || !resolved.startsWith(root)) return;
      const candidate = [resolved + ".ts", resolved + "/index.ts", resolved].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      expect(candidate, `Unresolved runtime import: ${file} -> ${target}`).toBeTruthy();
      if (candidate) inspect(candidate);
    }
    function visit(node: ts.Node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        if (ts.isImportDeclaration(node) && (node.importClause?.isTypeOnly || node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
          && !node.importClause.name && node.importClause.namedBindings.elements.every(element => element.isTypeOnly))) return;
        if (ts.isExportDeclaration(node) && node.isTypeOnly) return;
        follow(node.moduleSpecifier);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) follow(node.arguments[0]);
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  for (const entry of ["orders/confirmation/tradeLookup.ts", "orders/confirmation/fillResolution.ts", "orders/confirmation/orderFillReader.ts", "fok/orderSettlement.ts",
    "orders/confirmation/legOutcome.ts", "submission/recovery/pmUnknownSubmitRecovery.ts", "submission/pmManualSell.ts"])
    inspect(path.join(root, entry));
  expect(seen.size).toBeGreaterThan(20);
});

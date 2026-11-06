import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

it("snapshot modules cannot reach the order scheduler, network, account or browser storage", () => {
  const base = fileURLToPath(new URL("../../../../polymarket/orders/history/", import.meta.url));
  const seen = new Set<string>();
  const forbiddenPath = /(?:\/auth\/|\/transport\/|\/submission\/|\/confirmation\/|\/(?:orders|orderMarketReader|tradeReader|pmOrigin|pmStoredOrders|pmOrderSync|storedMarketRefresh|pmFee|pmClientApi)\.ts$)/;
  function inspect(file: string) {
    if (seen.has(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isIdentifier(node) && ["fetch", "localStorage", "sessionStorage", "XMLHttpRequest", "WebSocket"].includes(node.text))
        throw Error(`External state in snapshot dependency: ${file}: ${node.text}`);
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return;
        if (ts.isExportDeclaration(node) && node.isTypeOnly) return;
        const target = node.moduleSpecifier.text;
        if (target.startsWith(".")) {
          const resolved = path.resolve(path.dirname(file), target + ".ts");
          expect(resolved.replaceAll("\\", "/")).not.toMatch(forbiddenPath);
          inspect(resolved);
        }
        else if (target === "@changmen/client-core/shared/platforms") {
          // This approved constant leaf is inspected too; it must stay free of IO.
          inspect(fileURLToPath(new URL("../../../../../client-core/src/shared/platforms.ts", import.meta.url)));
        }
        else expect(target).toMatch(/^@changmen\/(?:shared\/(?:pm_[a-z_]+|currency|odds_format)|client-core\/contract)$/);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  ["orderSyncUpdate", "orderMarketSettlement", "orderSellAttribution", "orderTradeAmounts", "orderTradeProcessing", "orderTradeMapping"].forEach(name => inspect(path.join(base, name + ".ts")));
  inspect(path.resolve(base, "../facts/orderDisplayCurrency.ts"));
  inspect(path.resolve(base, "../facts/orderFillTotals.ts"));
  expect(seen.size).toBeGreaterThanOrEqual(6);
});

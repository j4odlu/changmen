import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";

export const originalLookupSource = execFileSync("git", ["show",
  "ea73dc5d2c65ccf2c320ddb9a852228fb15da269:server/backend/core/admin_tools/user_log_lookup.js"],
{ encoding: "utf8", windowsHide: true }).replaceAll("\r\n", "\n");
if (createHash("sha256").update(originalLookupSource).digest("hex") !== "58463fe7dc301e2207535e8f661145d66eb248c6a52f15f86168ab73aecef74a")
  throw new Error("Original backend order log lookup changed");
const tree = ts.createSourceFile("original.js", originalLookupSource, ts.ScriptTarget.Latest, true);
export const lookupExtractionGroups = {
  rules: ["linkTypeLabel", "groupMetaLabel", "computeLogWindow", "normalizeText", "textMatches", "orderLogMatchScore", "findBestOrderMatch", "isStrongLogOrderMatch", "sameLogActor", "filterRelevantLogs"],
  logs: ["parseLogData", "classifyLogTitle", "extractLogProvider", "extractLogOrderId", "extractLogTarget", "parseObRequestLine", "extractLogAccountLabel", "buildLogSegments", "summarizeUserLog"],
  sections: ["buildPlatformSections", "buildOrderSections", "sideDisplayLabel", "formatLegLabel", "inferTargetFromLogs", "createSideLegs", "legIndexForSide", "touchLegProvider", "refreshLegLabels", "resolveLegIndexByProvider", "pickLegIndexForUnassigned", "buildLegSections"],
  payload: ["normalizeOrderRow", "footballOrderToLogOrderRow", "toAdminOrderLogPayload", "diagnosticOrderRecords", "directObservationResult", "formatLookupReport", "formatCnTime"],
  query: ["resolveLookupUser", "lookupObservationOnly", "lookupOrderLogs"],
};
export const originalLookupFunctions = new Map(tree.statements.filter(ts.isFunctionDeclaration).map(node => [node.name.text, node.getText(tree)]));
export const originalLookupConstants = new Map(tree.statements.filter(ts.isVariableStatement).map(node => [node.declarationList.declarations[0].name.getText(tree), node.getText(tree)]));
export const originalLookupExports = tree.statements.filter(node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))
  .flatMap(node => ts.isVariableStatement(node) ? node.declarationList.declarations.map(declaration => declaration.name.getText(tree)) : [node.name.text]);
let executable = originalLookupSource;
for (const node of tree.statements.filter(ts.isImportDeclaration).reverse())
  executable = executable.slice(0, node.getFullStart()) + executable.slice(node.end);
executable = executable.replace(/^export /gm, "");
export function createOriginalLookup(ports) {
  return runInNewContext(`(() => {\n${executable}\nreturn { ${originalLookupExports.join(", ")} };\n})()`, {
    ...ports, console, Date, JSON, Error, Promise, URLSearchParams, Map, Set,
  });
}

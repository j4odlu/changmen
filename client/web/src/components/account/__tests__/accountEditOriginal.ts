import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { computed, reactive, ref } from "vue";
import type { AccountEditContext } from "../accountEditContext";

export const originalAccountDialog = execFileSync("git", ["show",
  "21e45cdee305f3e2ce44b8f475803ef0b0fc8324:client/web/src/components/account/AccountEditDialog.vue"],
{ encoding: "utf8", windowsHide: true }).replaceAll("\r\n", "\n");
if (createHash("sha256").update(originalAccountDialog).digest("hex") !== "47692c5c942e0f8e6120b84c31ce9d9a8d91692a0804600ce930e0991372299c")
  throw new Error("Original account dialog baseline changed");
export const originalAccountScript = originalAccountDialog.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1];
const tree = ts.createSourceFile("original.ts", originalAccountScript, ts.ScriptTarget.Latest, true);
export const originalAccountFunctions = new Map(tree.statements.filter(ts.isFunctionDeclaration)
  .map(node => [node.name!.text, node.getText(tree)]));
export const accountEditGroups = {
  polymarketAccountEditor: ["syncPolymarketFieldsFromToken", "resolvePolymarketPrivateKeyForSave", "ensurePrivateKeyInVault", "ensurePmVaultReadyBeforeCreate", "syncPolymarketWalletAddressFromPrivateKey", "syncPolymarketDerivedAddresses", "polymarketCredentialFingerprint", "buildPolyToken", "ensurePolymarketToken", "generatePolymarketApiCreds", "onGeneratePolymarketApiCreds", "polymarketRelayerSignUrl", "refreshPolymarketRelayerStatus", "resolvePolymarketRelayerSignatureType", "onPreparePolymarketWallet", "onDerivePolymarketAddresses"],
  predictFunAccountEditor: ["setPfPrivyAddressFromKey", "refreshPfPrivyAddressDisplay", "copyPfPrivyAddress", "syncPredictFunFieldsFromToken", "resolvePredictFunPrivyKeyForSave", "ensurePredictFunToken"],
  obSportAccountEditor: ["resetSportObForm", "sportObFromForm", "probeObSportCredentialForSave"],
  accountCredentialPaste: ["pasteFromClipboard", "onPasteQuickFill", "applyPaste"],
  accountEditSave: ["readStoredVenueMemberId", "requiresVenueMemberId", "normalizeRateConfig", "buildPatch", "resolvePlayerNameForSave", "probeVenueIdentityForSave", "save", "saveMultiplyAdmin", "saveAdminAccountFields"],
};
export function executableAccountSource(source: string) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, removeComments: true } }).outputText;
}
export function createOriginalAccountModule<T>(module: keyof typeof accountEditGroups, ctx: AccountEditContext,
  dependencies: Record<string, unknown>): T {
  const prefix = module === "polymarketAccountEditor" ? "poly" : module === "predictFunAccountEditor" ? "pf"
    : module === "obSportAccountEditor" ? "sportObForm" : module === "accountEditSave" ? "VENUE_" : "---";
  const state = tree.statements.filter(ts.isVariableStatement).filter(n =>
    n.declarationList.declarations.some(d => d.name.getText(tree).startsWith(prefix)));
  const variables = state.flatMap(n => n.declarationList.declarations.map(d => d.name.getText(tree)))
    .filter(name => !name.endsWith("Seq") && !name.startsWith("VENUE_"));
  const names = accountEditGroups[module];
  const sandbox = { computed, reactive, ref, console, Date, JSON, Error, Promise, structuredClone, navigator: globalThis.navigator,
    window: globalThis.window, ...ctx, ...dependencies };
  Object.defineProperty(sandbox, "form", { get: () => ctx.form });
  const cancel = module === "polymarketAccountEditor"
    ? "function cancelPending() { polyAsyncOpSeq += 1; polyGenerating.value = false; polyDerivingAddresses.value = false; }" : "";
  const factory = executableAccountSource(`(() => {
    ${state.map(node => node.getText(tree)).join("\n")}
    ${names.map(name => originalAccountFunctions.get(name)).join("\n")}
    ${cancel}
    return { ${[...variables, ...names, ...(cancel ? ["cancelPending"] : [])].join(",")} };
  })()`);
  return runInNewContext(factory, sandbox) as T;
}

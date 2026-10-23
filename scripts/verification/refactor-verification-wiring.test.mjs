import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import { restoreRefactorVerificationWiring } from "./refactor-verification-wiring.mjs";

const file = "scripts/verification/workspace-layout-relocation.mjs";
const source = fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const before = execFileSync("git", ["show", `21e45cdee305f3e2ce44b8f475803ef0b0fc8324:${file}`], { encoding: "utf8" }).replaceAll("\r\n", "\n");
test("restores the entire original checker only for the exact added refactor calls", () => {
  expect(restoreRefactorVerificationWiring(file, source)).toBe(before);
  expect(restoreRefactorVerificationWiring(file, source.replaceAll("\n", "\r\n"))).toBe(before);
  expect(restoreRefactorVerificationWiring(file, before)).toBe(before);
  expect(restoreRefactorVerificationWiring("unrelated.mjs", source)).toBe(source);
  for (const mutation of [
    `${source}\nvoid skipGuard();\n`,
    source.replace(" verifyPendingVenueFixes(read);", " // verifyPendingVenueFixes(read);"),
    source.replace("assertWorkspaceMoveSemantics(row,source);", "// assertWorkspaceMoveSemantics(row,source);"),
  ]) expect(restoreRefactorVerificationWiring(file, mutation)).toBe(mutation);
});

import {withAdapterHistoryReader,readAdapterHistory} from "./browser-entry-history.mjs";
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { accountPersistenceContract, restoreAccountPersistenceSource } from "./account-persistence-boundary.mjs";
import { gitSource, moduleTokens, replaceExact, verifyProtectedSource } from "./fok-exact-boundaries.mjs";

const read = withAdapterHistoryReader(file => readAdapterHistory(file, "utf8").replaceAll("\r\n", "\n"));
const contract = JSON.parse(read(accountPersistenceContract));
const changes = Object.entries(contract.files).flatMap(([file, rows]) => rows.map(row => ({ file, ...row })));

describe("exact account persistence increments preserve the original FOK modules", () => {
  it.each(Object.keys(contract.files))("restores the entire pre-change module: %s", file => {
    const restored = restoreAccountPersistenceSource(file, read(file), read, replaceExact);
    expect(moduleTokens(restored)).toEqual(moduleTokens(gitSource(contract.previousCommit, file)));
    const old = ts.createSourceFile(file, gitSource(contract.previousCommit, file), ts.ScriptTarget.Latest, true);
    for (const change of contract.files[file]) {
      const statement = old.statements.find(node => node.name?.text === change.name);
      expect(statement?.getText() ?? "").toBe(change.before);
    }
  });

  it.each(changes)("rejects changed behavior inside $file/$name", ({ file, after }) => {
    const end = after.lastIndexOf("}");
    const changed = `${after.slice(0, end)}\nvoid unapprovedPersistenceAction();\n${after.slice(end)}`;
    expect(() => restoreAccountPersistenceSource(file, read(file).replace(after, changed), read, replaceExact)).toThrow();
  });

  it.each(changes.filter(row => row.before))("rejects a partial rollback of $file/$name", ({ file, before, after }) => {
    expect(() => restoreAccountPersistenceSource(file, read(file).replace(after, before), read, replaceExact)).toThrow();
  });

  it.each(Object.keys(contract.files))("keeps unknown work visible to both fixed baselines: %s", file => {
    for (const base of ["219535c8", "75b1efac66625e5f2bc9884a965b244bfaf337ed"])
      expect(() => verifyProtectedSource(file, `${read(file)}\nvoid unapprovedTradingAction();`, gitSource(base, file), read, target => gitSource(base, target))).toThrow();
  });

  it("rejects modification of the reviewed increments contract", () => {
    const file = Object.keys(contract.files)[0];
    expect(() => restoreAccountPersistenceSource(file, read(file), target => target === accountPersistenceContract
      ? read(target).replace("preserveBalance", "replayBalance") : read(target), replaceExact)).toThrow("must remain exact");
  });
});

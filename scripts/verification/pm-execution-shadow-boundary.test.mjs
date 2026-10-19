import { restoreVenueBrowserExecution } from "./venue-browser-execution.mjs";
import { readAdapterHistory as readFileSync } from './browser-entry-history.mjs';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { verifyPmExecutionShadowContract } from './pm-execution-shadow-boundary.mjs';
const readBeforeExecution = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const read = file => restoreVenueBrowserExecution(file, readBeforeExecution(file));
const { changes } = JSON.parse(read('scripts/verification/pm-execution-shadow-increments.json'));
test('all three observation inputs restore to the previous complete sources', () => verifyPmExecutionShadowContract(read));
for (const [file, row] of Object.entries(changes)) {
  test(`${file}: missing input hook and unrelated edits both fail`, () => {
    assert.throws(() => verifyPmExecutionShadowContract(name => name === file ? read(name).replace(row.increments[0][1], row.increments[0][0]) : read(name)));
    assert.throws(() => verifyPmExecutionShadowContract(name => name === file ? read(name) + '\nvoid unexpectedOrder();' : read(name)));
  });
}
test('removing the explicit optimized-only guard is never exempted', () => {
  assert.throws(() => verifyPmExecutionShadowContract(file => read(file).replace('...(preflightMode === "optimized" ? { shadowInput:', '...(true ? { shadowInput:')));
});

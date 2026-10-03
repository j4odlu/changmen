import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const workflows = Object.fromEntries(['frontend', 'backend'].map(scope => [scope,
  YAML.parse(read(`.github/workflows/deploy-${scope}.yml`))]));

test('independent single-job workflows with separate production locks', () => {
  for (const [scope, workflow] of Object.entries(workflows)) {
    assert.deepEqual(Object.keys(workflow.jobs), ['deploy']);
    assert.equal(workflow.jobs.deploy.needs, undefined);
    assert.equal(workflow.concurrency['cancel-in-progress'], false);
    assert.equal(workflow.permissions.contents, 'read');
    assert.match(workflow.jobs.deploy.if, /refs\/heads\/master/);
    assert.ok(workflow.jobs.deploy.steps.some(s => s.run === `bash scripts/deploy/publish.sh ${scope}`));
  }
  assert.notEqual(workflows.frontend.concurrency.group, workflows.backend.concurrency.group);
});
test('root dependencies and shared packages trigger both; application paths stay separate', () => {
  for (const workflow of Object.values(workflows)) {
    for (const p of ['packages/**', 'package.json', 'package-lock.json', 'turbo.json'])
      assert.ok(workflow.on.push.paths.includes(p), p);
  }
  assert.ok(!workflows.frontend.on.push.paths.includes('server/**'));
  assert.ok(!workflows.backend.on.push.paths.includes('client/web/**'));
  assert.ok(workflows.backend.on.push.paths.includes('devtools/**'));
  assert.ok(workflows.backend.on.push.paths.includes('lines/**'));
});
test('frontend build receives no signing secrets and runs the build typecheck once', () => {
  const steps = workflows.frontend.jobs.deploy.steps;
  const build = steps.find(s => s.run?.includes('app:build'));
  assert.ok(build);
  assert.ok(!JSON.stringify(build).includes('secrets.'));
  assert.ok(!steps.some(s => s.uses?.includes('artifact')));
  assert.ok(!steps.some(s => s.run?.includes('typecheck:frontend')));
});

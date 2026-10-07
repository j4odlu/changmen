import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

test('paired pushes wait for the matching backend after checks and before frontend publication', () => {
  const frontend = workflows.frontend;
  const steps = frontend.jobs.deploy.steps;
  const gate = steps.findIndex(s => s.run === 'node scripts/deploy/wait-for-backend.mjs');
  const publish = steps.findIndex(s => s.run === 'bash scripts/deploy/publish.sh frontend');
  const build = steps.findIndex(s => s.run?.includes('npm run app:build'));
  assert.ok(build < gate && gate < publish);
  assert.equal(steps[gate].if, "github.event_name == 'push'");
  assert.equal(frontend.permissions.actions, 'read');
  assert.equal(steps.find(s => s.uses?.startsWith('actions/checkout@')).with['fetch-depth'], 0);
  assert.ok(frontend.jobs.deploy['timeout-minutes'] >= 60);
  assert.ok(frontend.on.push.paths.includes('scripts/deploy/wait-for-backend*.mjs'));
  assert.ok(steps.some(s => s.run?.includes('scripts/deploy/wait-for-backend.test.mjs')));
});

test('backend deployment tests every server workspace without running web tests', () => {
  const steps = workflows.backend.jobs.deploy.steps;
  assert.ok(steps.some(s => s.run?.includes('npm run test:backend')));
  assert.ok(!steps.some(s => /\bnpm test\b|npm run check:boundaries/.test(s.run || '')));
  const root = JSON.parse(read('package.json'));
  assert.ok(JSON.parse(read('server/backend/package.json')).scripts.test.includes('core/integrations/polymarket'));
  const filter = root.scripts['test:backend'].match(/--filter=(\S+)/)[1];
  const graph = JSON.parse(execFileSync(process.execPath, [
    fileURLToPath(new URL('../../node_modules/turbo/bin/turbo', import.meta.url)),
    'run', 'test', `--filter=${filter}`, '--dry=json',
  ], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' }));
  assert.ok(!graph.tasks.some(t => t.taskId === '@changmen/web#test'));
  for (const workspace of root.workspaces.filter(p => p.startsWith('server/'))) {
    const paths = workspace.endsWith('/*')
      ? readdirSync(new URL(`../../${workspace.slice(0, -1)}`, import.meta.url), { withFileTypes: true })
        .filter(entry => entry.isDirectory()).map(entry => workspace.replace('*', entry.name))
      : [workspace];
    for (const p of paths) {
      const pkg = JSON.parse(read(`${p}/package.json`));
      if (pkg.scripts?.test)
        assert.ok(graph.tasks.some(t => t.taskId === `${pkg.name}#test`), pkg.name);
    }
  }
  const matcher = graph.tasks.find(t => t.taskId === '@changmen/matcher#test');
  assert.ok(matcher.dependencies.includes('@changmen/match-identity#test'));
  assert.ok(!matcher.command.includes('prefix ../identity'));
  assert.equal(graph.tasks.filter(t => t.taskId === '@changmen/match-identity#test').length, 1);
});

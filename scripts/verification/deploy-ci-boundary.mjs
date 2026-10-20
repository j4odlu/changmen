// [changmen 扩展] Exact deployment fixes on top of the immutable workspace migration proof.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha = source => createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex');
const changes = new Map([
  ['scripts/deploy/workflows.test.mjs', {
    beforeSha: '084a7fb67b6aa9033c85256e6b497e678e41f5bf363e153da9cdeb23f8a9e903',
    afterSha: 'cdec5827e8e08db361d10462d14efbf315c1ac4c63052d75baef10a03d2d4034',
    edits: [[
      `  // Runtime outputs can be dropped when a patch number matches a masked secret.
  // Every runner must select the supported major without depending on that output.
  for (const job of [release.jobs.plan, release.jobs.checks, release.jobs.validate])
    assert.equal(job.steps.find(step => step.uses?.startsWith("actions/setup-node@")).with["node-version"], "24");
  assert.equal(release.jobs.plan.outputs["node-version"], undefined);`,
      '  for (const job of [release.jobs.checks, release.jobs.validate])\n    assert.equal(job.steps.find(step => step.uses?.startsWith("actions/setup-node@")).with["node-version"], "${{ needs.plan.outputs.node-version }}");',
    ]],
  }],
  ['scripts/deploy/release-evidence.test.mjs', {
    beforeSha: '61253ce795be375b21551edd3e7b3ed965c0c8134c4505f1abaa76d629cf335c',
    afterSha: 'e7f4521327263446611d10ef4e229257691dd813a87095ee784c7c8f8c7d0a11',
    edits: [
      ['"\\n/node_modules\\n"', '"\\nnode_modules/\\n"'],
      ['  assert.equal(git(root, "ls-files", "node_modules"), "", "Overwriting fixture .gitignore must not commit dependency links");\n', ''],
    ],
  }],
]);
export function restoreDeployCiSource(file, source) {
  const change = changes.get(file);
  if (!change || sha(source) !== change.afterSha) return source;
  source = source.replaceAll('\r\n', '\n');
  for (const [after, before] of change.edits) {
    assert.equal(source.split(after).length, 2, `${file}: deployment increment must occur once`);
    source = source.replace(after, before);
  }
  assert.equal(sha(source), change.beforeSha, `${file}: original workspace proof must restore`);
  return source;
}

// [changmen 扩展] 固定候选基底的只读 Git 范围检查；不创建提交或修改暂存区。
import assert from 'node:assert/strict';
import {historicalWorkspaceFs as fs} from './workspace-layout-history.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const scopePath = 'scripts/verification/orders-phase2-release-scope.json';
export const normalizedSha = text => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
const normal = text => text.replaceAll('\r\n', '\n');
const sorted = values => [...new Set(values)].sort();

export function parseGitPaths(output) {
  if (!output.length) return [];
  assert(output.endsWith('\0'), 'Git path output must be NUL terminated');
  return output.slice(0, -1).split('\0').map(file => {
    assert(file && !/[\r\n\\]/.test(file) && !file.startsWith('/') && !/^[A-Za-z]:/.test(file)
      && !file.split('/').some(part => part === '..' || part === '.' || part === ''), `unsafe Git path: ${file}`);
    return file;
  });
}

export function createReadonlyGitScope(cwd = process.cwd()) {
  const git = (args, options = {}) => execFileSync('git', ['--no-optional-locks', ...args], {
    cwd, encoding: 'utf8', maxBuffer: 80 * 1024 * 1024, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'], ...options,
  });
  const paths = args => parseGitPaths(git(args));
  return {
    head: () => git(['rev-parse', '--verify', 'HEAD^{commit}']).trim(),
    assertAncestor: (base, head) => git(['merge-base', '--is-ancestor', base, head]),
    committedPaths: (base, head) => paths(['diff', '--no-renames', '--name-only', '-z', base, head, '--']),
    indexPaths: base => paths(['diff', '--cached', '--no-renames', '--name-only', '-z', base, '--']),
    workingPaths: base => paths(['diff', '--no-renames', '--name-only', '-z', base, '--']),
    untrackedPaths: () => paths(['ls-files', '--others', '--exclude-standard', '-z']),
    basePaths: base => paths(['ls-tree', '-r', '--name-only', '-z', base]),
    readBlobs: (ref, files) => {
      if (!files.length) return {};
      for (const file of files) parseGitPaths(file + '\0');
      const records = git(ref === ':'
        ? ['ls-files', '--stage', '-z', '--', ...files]
        : ['ls-tree', '-r', '-z', ref, '--', ...files]).split('\0').filter(Boolean).map(record => {
          const separator = record.indexOf('\t');
          assert(separator > 0, 'invalid Git mode record');
          const header = record.slice(0, separator).split(' ');
          assert(['100644', '100755'].includes(header[0]), 'candidate source must be a regular Git file');
          assert(ref === ':' ? header[2] === '0' : header[1] === 'blob', 'candidate source must be an unmerged-free blob');
          return parseGitPaths(record.slice(separator + 1) + '\0')[0];
        });
      assert.deepEqual(sorted(records), sorted(files), `${ref}: missing candidate Git blob`);
      const data = git(['cat-file', '--batch'], {
        encoding: null, input: files.map(file => ref === ':' ? `:${file}` : `${ref}:${file}`).join('\n') + '\n',
      });
      const result = {}; let offset = 0;
      for (const file of files) {
        const end = data.indexOf(10, offset);
        assert(end >= offset, 'missing Git blob header');
        const header = data.subarray(offset, end).toString().split(' ');
        assert.equal(header[1], 'blob', `${ref}:${file}: expected blob`);
        const size = Number(header[2]);
        assert(Number.isSafeInteger(size) && size >= 0 && end + 1 + size < data.length, 'invalid Git blob size');
        result[file] = data.subarray(end + 1, end + 1 + size).toString();
        offset = end + 1 + size + 1;
      }
      assert.equal(offset, data.length, 'unexpected Git batch payload');
      return result;
    },
  };
}

export function verifyGitScope({ scope, scopeText, fixedBase, metadataPath = scopePath, git = createReadonlyGitScope(), readFile = file => {
  assert(fs.lstatSync(file).isFile(), `${file}: candidate source must be a regular file`);
  return fs.readFileSync(file, 'utf8');
} }) {
  assert(/^[a-f0-9]{40}$/.test(fixedBase), 'fixed candidate base must be a full commit ID');
  assert.equal(scope.base, fixedBase, 'candidate base cannot be replaced');
  assert.deepEqual(JSON.parse(scopeText), scope, 'scope text and parsed manifest disagree');
  const approved = Object.keys(scope.allowedFiles);
  for (const file of [...approved, metadataPath]) parseGitPaths(file + '\0');
  assert(!approved.includes(metadataPath), 'scope metadata is checked separately');
  assert(approved.length > 0, 'candidate file list cannot be empty');
  for (const digest of Object.values(scope.allowedFiles)) assert(/^[a-f0-9]{64}$/.test(digest), 'invalid candidate digest');
  const head = git.head();
  assert(/^[a-f0-9]{40}$/.test(head), 'HEAD must be a full commit ID');
  git.assertAncestor(fixedBase, head);
  const committed = git.committedPaths(fixedBase, head);
  const staged = git.indexPaths(fixedBase);
  const working = git.workingPaths(fixedBase);
  // 唯一既有例外：未跟踪的本机 output 验收产物。已提交/暂存/跟踪的 output 不豁免。
  const untracked = git.untrackedPaths().filter(file => !file.startsWith('output/'));
  const expected = sorted([...approved, metadataPath]);
  const observed = sorted([...committed, ...staged, ...working, ...untracked]);
  assert.deepEqual(observed, expected, 'candidate changed path set must equal the explicit release manifest');
  assert.deepEqual(sorted([...working, ...untracked]), expected, 'working candidate must contain the complete fixed-base package');
  const verifyContent = (files, read, source) => {
    for (const file of files) {
      const content = read(file);
      if (file === metadataPath) assert.equal(normal(content), normal(scopeText), `${source}: scope metadata changed`);
      else assert.equal(normalizedSha(content), scope.allowedFiles[file], `${source}:${file}: candidate content changed`);
    }
  };
  verifyContent(expected, readFile, 'worktree');
  const index = git.readBlobs(':', sorted(staged));
  verifyContent(sorted(staged), file => index[file], 'index');
  if (head !== fixedBase) {
    assert.deepEqual(sorted(committed), expected, 'committed candidate must contain the complete approved package');
    assert.deepEqual(sorted(staged), expected, 'index must retain the complete committed candidate package');
    const contents = git.readBlobs(head, expected);
    verifyContent(expected, file => contents[file], 'HEAD');
  } else assert.equal(committed.length, 0, 'base HEAD must have no committed candidate delta');
  return {
    fixedBase, head, mode: head === fixedBase ? 'before-commit' : 'after-commit',
    changedPaths: approved.length, committedPaths: committed.length, indexPaths: staged.length,
    committedContentVerified: head !== fixedBase, indexContentVerified: true, performedCommit: false,
  };
}

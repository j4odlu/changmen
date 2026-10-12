// [changmen 扩展] 模拟候选提交状态，实际 Git 仅只读既有历史；测试不创建提交或修改索引。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createReadonlyGitScope, verifyGitScope, parseGitPaths, normalizedSha, scopePath } from './orders-phase2-git-scope.mjs';
import { deployedSource } from './orders-phase2-release-boundary.mjs';

const base = 'a'.repeat(40), committedHead = 'b'.repeat(40);
function fixture(mode = 'before', actual = false) {
  const source = actual
    ? JSON.parse(fs.readFileSync(scopePath, 'utf8'))
    : { base, allowedFiles: { 'server/new helper.js': normalizedSha('safe\n'), 'scripts/check.mjs': normalizedSha('guard\n') } };
  const scope = structuredClone(source), scopeText = JSON.stringify(scope, null, 2);
  const expected = [...Object.keys(scope.allowedFiles), scopePath];
  const contents = actual
    ? Object.fromEntries(Object.keys(scope.allowedFiles).map(file => [file, fs.readFileSync(file, 'utf8')]))
    : { 'server/new helper.js': 'safe\n', 'scripts/check.mjs': 'guard\n' };
  contents[scopePath] = scopeText;
  const state = {
    head: mode === 'before' || mode === 'staged' ? scope.base : committedHead,
    ancestor: true,
    committed: mode === 'after' ? [...expected] : [],
    index: mode === 'after' || mode === 'staged' ? [...expected] : [],
    working: mode === 'before' ? expected.filter(file => file !== 'server/new helper.js' && file !== scopePath) : [...expected],
    untracked: mode === 'before' ? ['server/new helper.js', scopePath, 'output/report.json'] : ['output/report.json'],
    workContents: { ...contents }, indexContents: { ...contents }, headContents: { ...contents },
  };
  // 实际候选模拟未提交时所有已批准文件均作为工作区 delta，内容来自实际候选。
  if (actual && mode === 'before') { state.working = [...expected]; state.untracked = ['output/report.json']; }
  const calls = [];
  const git = {
    head: () => state.head,
    assertAncestor: (fixed, head) => { calls.push(['ancestor', fixed, head]); if (!state.ancestor) throw Error('base is not ancestor'); },
    committedPaths: fixed => { expect(fixed).toBe(scope.base); return state.committed; },
    indexPaths: fixed => { expect(fixed).toBe(scope.base); return state.index; },
    workingPaths: fixed => { expect(fixed).toBe(scope.base); return state.working; },
    untrackedPaths: () => state.untracked,
    readBlobs: (ref, files) => {
      calls.push(['read', ref, ...files]);
      return Object.fromEntries(files.map(file => [file, (ref === ':' ? state.indexContents : state.headContents)[file]]));
    },
  };
  const run = () => verifyGitScope({ scope, scopeText, fixedBase: actual ? deployedSource : base, git, readFile: file => {
    if (!(file in state.workContents)) throw Error('missing working file');
    return state.workContents[file];
  } });
  return { scope, state, expected, calls, run };
}

describe('fixed-base candidate scope before and after commit', () => {
  it.each(['before', 'staged', 'after'])('accepts the identical package in %s state', mode => {
    const f = fixture(mode); const result = f.run();
    expect(result.fixedBase).toBe(base);
    expect(result.mode).toBe(mode === 'after' ? 'after-commit' : 'before-commit');
    expect(result.changedPaths).toBe(2);
    expect(result.performedCommit).toBe(false);
    expect(result.committedContentVerified).toBe(mode === 'after');
    if (mode === 'after') expect(f.calls.some(row => row[0] === 'read' && row[1] === committedHead)).toBe(true);
  });
  it.each(['before', 'staged', 'after'])('checks actual candidate bytes in simulated %s state', mode => {
    const f = fixture(mode, true);
    expect(f.run().changedPaths).toBe(Object.keys(f.scope.allowedFiles).length);
  });
  it('accepts an approved partially staged package before commit', () => {
    const f = fixture('staged'); f.state.index = ['scripts/check.mjs']; expect(f.run().mode).toBe('before-commit');
  });
  it('preserves CRLF/LF compatibility in every state', () => {
    const f = fixture('after');
    for (const map of [f.state.workContents, f.state.indexContents, f.state.headContents]) for (const key of Object.keys(map)) map[key] = map[key].replaceAll('\n', '\r\n');
    expect(f.run().committedContentVerified).toBe(true);
  });
  const reject = [
    ['replacement base', f => { f.scope.base = 'c'.repeat(40); }],
    ['unrelated HEAD', f => { f.state.ancestor = false; }],
    ['invalid HEAD', f => { f.state.head = 'HEAD'; }],
    ['partial commit masked by complete worktree', f => { f.state.committed.pop(); }],
    ['unexpected committed path masked by worktree deletion', f => { f.state.committed.push('server/extra.js'); }],
    ['unexpected staged path', f => { f.state.index.push('server/extra.js'); }],
    ['unexpected tracked working path', f => { f.state.working.push('server/extra.js'); }],
    ['unexpected untracked path', f => { f.state.untracked.push('server/extra.js'); }],
    ['committed output file', f => { f.state.committed.push('output/hidden.js'); }],
    ['staged output file', f => { f.state.index.push('output/hidden.js'); }],
    ['tracked output file', f => { f.state.working.push('output/hidden.js'); }],
    ['changed committed bytes masked by correct worktree', f => { f.state.headContents['scripts/check.mjs'] = 'bad\n'; }],
    ['changed index bytes masked by correct worktree', f => { f.state.indexContents['scripts/check.mjs'] = 'bad\n'; }],
    ['changed working bytes', f => { f.state.workContents['scripts/check.mjs'] = 'bad\n'; }],
    ['missing approved working file', f => { delete f.state.workContents['server/new helper.js']; }],
    ['missing committed blob', f => { delete f.state.headContents['server/new helper.js']; }],
    ['missing index blob', f => { delete f.state.indexContents['server/new helper.js']; }],
    ['index revert masked by correct committed and working bytes', f => { f.state.index = f.state.index.filter(file => file !== 'scripts/check.mjs'); }],
    ['index metadata deletion masked by committed manifest', f => { f.state.index = f.state.index.filter(file => file !== scopePath); }],
    ['committed manifest drift masked by worktree', f => { f.state.headContents[scopePath] = '{}'; }],
    ['staged manifest drift masked by worktree', f => { f.state.indexContents[scopePath] = '{}'; }],
    ['working manifest drift', f => { f.state.workContents[scopePath] = '{}'; }],
    ['worktree deleted and index masks package', f => { f.state.working.pop(); }],
    ['unapproved renamed file', f => { f.state.working.push('server/renamed.js'); }],
    ['missing metadata from commit', f => { f.state.committed = f.state.committed.filter(file => file !== scopePath); }],
    ['weakened content hash', f => { f.scope.allowedFiles['scripts/check.mjs'] = 'bad'; }],
    ['scope metadata added to hash exemptions', f => { f.scope.allowedFiles[scopePath] = normalizedSha('{}'); }],
  ];
  it.each(reject)('rejects %s', (_name, mutate) => {
    const f = fixture('after'); mutate(f); expect(f.run).toThrow();
  });
  it('rejects incorrect staged bytes before any candidate commit', () => {
    const f = fixture('staged'); f.state.indexContents['scripts/check.mjs'] = 'bad'; expect(f.run).toThrow();
  });
});

describe('readonly real Git and NUL path parsing', () => {
  it('reads existing index blobs without changing the index', () => {
    const git = createReadonlyGitScope();
    const indexPath = execFileSync('git', ['rev-parse', '--git-path', 'index'], { encoding: 'utf8' }).trim();
    const before = fs.readFileSync(indexPath);
    const blobs = git.readBlobs(':', ['package.json']);
    expect(JSON.parse(blobs['package.json']).name).toBe(JSON.parse(fs.readFileSync('package.json', 'utf8')).name);
    expect(fs.readFileSync(indexPath)).toEqual(before);
  });
  it('detects already committed paths from existing history without creating commits', () => {
    const git = createReadonlyGitScope();
    const headBefore = git.head();
    const parent = execFileSync('git', ['rev-parse', `${deployedSource}^`], { encoding: 'utf8' }).trim();
    git.assertAncestor(parent, deployedSource);
    const paths = git.committedPaths(parent, deployedSource);
    expect(paths.length).toBeGreaterThan(0);
    const blobs = git.readBlobs(deployedSource, paths);
    expect(Object.keys(blobs).sort()).toEqual([...paths].sort());
    expect(git.basePaths(deployedSource)).not.toContain('server/db/rds/orders_execution_compat.js');
    expect(git.head()).toBe(headBefore);
  });
  it('fails closed when the fixed base does not exist', () => {
    const git = createReadonlyGitScope(); expect(() => git.assertAncestor('0'.repeat(40), git.head())).toThrow();
  });
  it('preserves spaces, tabs and Unicode paths', () => {
    expect(parseGitPaths('server/a b.js\0文档/验收\t记录.md\0')).toEqual(['server/a b.js', '文档/验收\t记录.md']);
  });
  it.each(['server/a.js', '\0', '../secret\0', '/absolute\0', 'C:/secret\0', 'a\\b\0', 'a\nb\0', 'a/./b\0'])('rejects unsafe/malformed path output %j', output => {
    expect(() => parseGitPaths(output)).toThrow();
  });
});

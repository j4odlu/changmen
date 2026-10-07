// A shared change may require a new API. Keep frontend-only releases independent,
// but never activate a paired frontend before the same commit's backend succeeds.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';

export function needsBackendRelease(paths, patterns) {
  return paths.some(path => patterns.some(pattern => pattern.endsWith('/**')
    ? path.startsWith(pattern.slice(0, -2)) : path === pattern));
}

export async function waitForBackend({ sha, listRuns, sleep, now = Date.now, log = console.log,
  timeoutMs = 40 * 60_000, pollMs = 15_000 }) {
  const deadline = now() + timeoutMs;
  let lastStatus;
  while (now() < deadline) {
    const runs = (await listRuns()).filter(run => run.headSha === sha && run.headBranch === 'master');
    const latest = runs.sort((a, b) => b.databaseId - a.databaseId)[0];
    const status = latest ? `${latest.databaseId}: ${latest.status} / ${latest.conclusion || 'pending'}` : 'waiting for backend run';
    if (status !== lastStatus) { log(status); lastStatus = status; }
    if (latest?.status === 'completed') {
      if (latest.conclusion === 'success') return;
      throw new Error(`Backend ${sha} did not succeed (${latest.conclusion}); frontend remains unpublished`);
    }
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for backend ${sha}; frontend remains unpublished`);
}

async function main() {
  const sha = process.env.GITHUB_SHA;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[a-f0-9]{40}$/.test(sha || '') || !/^[\w.-]+\/[\w.-]+$/.test(repo || ''))
    throw new Error('GITHUB_SHA and GITHUB_REPOSITORY are required');
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const workflow = YAML.parse(readFileSync(new URL('../../.github/workflows/deploy-backend.yml', import.meta.url), 'utf8'));
  const before = event.before;
  const paths = execFileSync('git', /^[a-f0-9]{40}$/.test(before || '') && !/^0+$/.test(before)
    ? ['diff', '--name-only', before, sha] : ['ls-tree', '-r', '--name-only', sha], { encoding: 'utf8' })
    .trim().split(/\r?\n/).filter(Boolean);
  if (!needsBackendRelease(paths, workflow.on.push.paths)) {
    console.log('Frontend-only change: no backend release required');
    return;
  }
  await waitForBackend({ sha,
    listRuns: () => JSON.parse(execFileSync('gh', ['run', 'list', '--repo', repo,
      '--workflow', 'deploy-backend.yml', '--commit', sha, '--branch', 'master', '--limit', '100',
      '--json', 'databaseId,headSha,headBranch,status,conclusion'], { encoding: 'utf8', timeout: 30_000 })),
    sleep: ms => new Promise(done => setTimeout(done, ms)),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(err => { console.error(err.message); process.exitCode = 1; });

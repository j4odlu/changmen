// Local-only public-market verification harness. No login, order, or deployment endpoints.
import { createServer } from 'vite';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const out = path.join(root, process.argv.includes('--isolation') ? 'output/playwright/pm-asset-isolation' : process.argv.includes('--availability') ? 'output/pm-book-availability' : process.argv.includes('--execution') ? 'output/pm-execution-simulation' : process.argv.includes('--mailbox') ? 'output/pm-mailbox-repair' : process.argv.includes('--refactor') ? 'output/pm-shared-book-refactor' : process.argv.includes('--repair') ? 'output/pm-passive-browser-repair' : 'output/pm-passive-browser');
await mkdir(out, { recursive: true });
const workers = (await readdir(path.join(root, 'client/web/dist/assets'))).filter(n => /^marketData\.worker-.*\.js$/.test(n));
if (workers.length !== 1) throw new Error('Run app:build first; expected exactly one production market-data Worker');
const server = await createServer({ configFile: false, root, resolve: { alias: { '@': path.join(root, 'client/web/src') } }, server: { host: '127.0.0.1', port: 5581, strictPort: true, hmr: false, watch: { ignored: ['**/output/**', '**/.playwright-cli/**'] } },
  plugins: [{ name: 'local-evidence', configureServer(s) {
    s.middlewares.use('/verification-candidates.json', async (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(await readFile(path.join(out, 'candidates.json'), 'utf8')); });
    s.middlewares.use('/verification-gate-controller.js', async (_req, res) => {
      // Preserve the gate logic verbatim, replacing only application-store and consumer imports.
      const source = await readFile(path.join(root, 'client/web/src/runtime/pmDynamicWsPreflight.ts'), 'utf8');
      const { transform } = await import('esbuild');
      const code = source.replace('"@/stores/userStore"', '"/scripts/verification/pm-passive-browser-gate-fixture.ts"')
        .replace('"./pmMarketData"', '"/scripts/verification/pm-passive-browser-gate-fixture.ts"')
        .replace('"./pmBookSettings"', '"/client/web/src/runtime/pmBookSettings.ts"')
        .replace('"@changmen/venue-adapter/polymarket/pmFokPreflightMode"', '"/packages/venue-adapter/polymarket/pmFokPreflightMode.ts"')
        .replace('"vue"', '"/scripts/verification/pm-passive-browser-gate-fixture.ts"');
      res.setHeader('Content-Type', 'text/javascript'); res.end((await transform(code, { loader: 'ts', format: 'esm' })).code);
    });
    s.middlewares.use('/verification-worker.json', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ url: `/client/web/dist/assets/${workers[0]}`, outputBase: `/${path.relative(root, out).replaceAll('\\', '/')}` })); });
    s.middlewares.use('/verification-evidence', async (req, res) => {
      if (req.method !== 'POST' || req.headers.origin !== 'http://127.0.0.1:5581') { res.statusCode = 403; res.end(); return; }
      let body = ''; try {
        for await (const chunk of req) { body += chunk; if (body.length > 30_000_000) throw new Error('bounded evidence limit'); }
        const data = JSON.parse(body);
        if (!/^[a-z0-9-]{1,48}$/.test(data.name)) throw new Error('invalid name');
        await writeFile(path.join(out, `${data.name}.json`), JSON.stringify(data.value, null, 2)); res.end('saved');
      } catch (error) { res.statusCode = 400; res.end(String(error)); }
    });
  } }] });
await server.listen();
console.log('http://127.0.0.1:5581/scripts/verification/pm-passive-browser.html');

// Package the reviewed local reports; production builds use the committed output.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const reports = resolve(root, 'output/aaaa298-price-logic');
const dest = resolve(root, 'client/web/public/aaaa298');
const pages = ['index.html', 'escalation.html', 'price-only.html'];
const files = new Map();
const nav = '<nav style="padding:12px 20px;background:#101a28;color:#dce6f1;font:14px sans-serif;display:flex;gap:20px;flex-wrap:wrap">NAV_LINKS<span>只读监控 · 打开页面后刷新；研究报告为固定样本</span></nav>';
function withNav(html, research) {
  html = html.replaceAll('\r\n', '\n');
  const links = research
    ? '<a style="color:#83c9ff" href="../index.html">交易与仓位监控</a><a style="color:#83c9ff" href="index.html">价格研究</a><a style="color:#83c9ff" href="price-only.html">纯价格策略研究</a>'
    : '<a style="color:#83c9ff" href="research/index.html">价格与下注研究</a><a style="color:#83c9ff" href="research/price-only.html">纯价格策略研究</a>';
  const navigation = nav.replace('NAV_LINKS', links);
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, body => body + navigation);
  if (html.includes('<main>')) return html.replace('<main>', navigation + '<main>');
  throw new Error('Missing body/main');
}
files.set('index.html', Buffer.from(withNav(readFileSync(resolve(root, 'output/aaaa298-tracker/index.html'), 'utf8'), false)));
for (const page of pages) {
  let html = readFileSync(resolve(reports, page), 'utf8');
  const links = [...html.matchAll(/href=["']([^"']+)["']/g)].map(m => m[1]);
  for (const link of new Set(links)) {
    if (/^(?:#|https?:|data:)/.test(link) || pages.includes(link)) continue;
    if (!/^[a-zA-Z0-9_./-]+\.(csv|json)$/.test(link)) throw new Error(`Unexpected asset: ${link}`);
    const source = resolve(reports, link);
    if (!source.startsWith(reports + sep) || !existsSync(source)) throw new Error(`Invalid asset: ${link}`);
    const data = readFileSync(source);
    if (link.endsWith('.csv')) {
      files.set(`research/${link}.gz`, gzipSync(data, { level: 9 }));
      html = html.replaceAll(`href="${link}"`, `title="下载 gzip 压缩 CSV，解压后可用表格软件打开" href="${link}.gz"`);
    } else files.set(`research/${link}`, Buffer.from(data.toString('utf8').replaceAll('\r\n', '\n')));
  }
  files.set(`research/${page}`, Buffer.from(withNav(html, true)));
}
const manifest = [];
for (const [name, data] of files) {
  const target = resolve(dest, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
  manifest.push({ path: relative(dest, target).replaceAll('\\', '/'), bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
writeFileSync(resolve(dest, 'manifest.json'), JSON.stringify({ files: manifest }, null, 2) + '\n');
console.log(`Packaged ${manifest.length} files, ${manifest.reduce((n, f) => n + f.bytes, 0)} bytes`);

import path from "node:path";
import type { Plugin } from "vite";
import { captureRuntimeVersion, readSourceVersion } from "@changmen/shared/tooling/runtime_version.js";

/** [changmen 扩展] 独立只读诊断页；不改变应用启动、登录、交易或轮询。 */
export function versionPage(): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>changmen 运行版本</title><style>body{font:16px system-ui;margin:32px auto;padding:0 20px;max-width:880px;color:#172033;background:#f5f7fb}table{width:100%;border-collapse:collapse;background:white}td,th{padding:14px;text-align:left;border-bottom:1px solid #e5e7eb;overflow-wrap:anywhere}th{width:160px}p{line-height:1.6}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{padding:8px 16px;cursor:pointer}</style>
<h1>运行版本</h1><p>前后端分别显示实际运行身份。源码更新后，后端需要重启才能加载；前后端可独立发布。</p>
<button id="refresh">刷新</button><p id="status" role="status">正在读取…</p><table><tbody id="rows"></tbody></table><details><summary>完整诊断信息</summary><pre id="details"></pre></details>
<script type="module">
const status=document.querySelector('#status'),rows=document.querySelector('#rows');
const show=(label,value)=>{const tr=document.createElement('tr'),th=document.createElement('th'),td=document.createElement('td');th.textContent=label;td.textContent=value??'未知';tr.append(th,td);rows.append(tr);};
const identity=v=>v?.commit ? v.commit+(v.dirty===true?'（含未提交源码）':v.dirty===null?'（修改状态未知）':'') : '未知';
async function load(){rows.replaceChildren();status.textContent='正在读取…';document.querySelector('#details').textContent='';let frontend;
try{const r=await fetch('./runtime-version.json',{cache:'no-store'});if(!r.ok)throw Error('前端版本读取失败');frontend=await r.json();show('前端启动/构建版本',identity(frontend.frontend));show('前端启动/构建时间',frontend.frontend.startedAt);}
catch(e){status.textContent=e.message;return;}
if(frontend.workspace){show('前端当前源码',identity(frontend.workspace));show('前端开发源码',frontend.workspace.sourceFingerprint===frontend.frontend.sourceFingerprint?'与启动时一致':'与服务启动时不同；当前源码见上一行');}
try{const r=await fetch(frontend.backendUrl,{cache:'no-store',credentials:'include'});if(!r.ok)throw Error('后端版本读取失败（HTTP '+r.status+'）');if(!r.headers.get('content-type')?.includes('application/json'))throw Error('后端尚未提供版本接口，请先升级或重启后端');const backend=await r.json();if(!backend.backend?.startedAt||!backend.database)throw Error('后端版本响应无效');
show('后端运行版本',identity(backend.backend));show('后端启动时间',backend.backend.startedAt);show('磁盘源码版本',identity(backend.workspace));
show('后端源码变更',backend.restartRequired===true?'需重启后端加载当前源码':backend.restartRequired===false?'与进程启动时的源码一致':'未知');
show('接口契约指纹',frontend.frontend.contractFingerprint&&backend.backend.contractFingerprint ? frontend.frontend.contractFingerprint===backend.backend.contractFingerprint?'一致':'不同，请核对发布组合':'未知');
show('数据库结构指纹',backend.database.schemaFingerprint);show('数据库迁移版本',backend.database.migrationVersion??'尚未建立迁移版本记录');
document.querySelector('#details').textContent=JSON.stringify({frontend,backend},null,2);status.textContent='读取完成';
}catch(e){status.textContent=e.message;document.querySelector('#details').textContent=JSON.stringify({frontend},null,2);}}
document.querySelector('#refresh').addEventListener('click',load);load();
</script></html>`;
}
export function runtimeBackendUrl(apiBase = ""): string {
  if (!apiBase) return "/api/runtime-version";
  const url = new URL(apiBase);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("运行版本 API 地址必须为 HTTP(S)");
  return `${url.origin}${url.pathname.replace(/\/$/, "")}/api/runtime-version`;
}
export function runtimeVersionPlugin(root: string, apiBase = ""): Plugin {
  const backendUrl = runtimeBackendUrl(apiBase);
  const running = captureRuntimeVersion(path.resolve(root), "frontend", { startedAt: new Date().toISOString() });
  const metadata = (development: boolean) => ({ frontend: running, backendUrl, ...(development ? { workspace: readSourceVersion(root, "frontend") } : {}) });
  return {
    name: "changmen-runtime-version",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split("?")[0];
        if (!["/runtime-version.json", "/runtime-version.html"].includes(pathname ?? "")) { next(); return; }
        if (req.method !== "GET") { res.statusCode = 405; res.end("GET required"); return; }
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", pathname?.endsWith(".json") ? "application/json; charset=utf-8" : "text/html; charset=utf-8");
        res.end(pathname?.endsWith(".json") ? JSON.stringify(metadata(true)) : versionPage());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "runtime-version.json", source: JSON.stringify(metadata(false)) });
      this.emitFile({ type: "asset", fileName: "runtime-version.html", source: versionPage() });
    },
  };
}

/** [changmen 扩展] 手动 GET 前后端运行身份；不触发订单 API、刷新或重启。 */
import path from "node:path";
import { fileURLToPath } from "node:url";
export async function inspectRuntimeVersion(address, fetcher = fetch) {
  const base = new URL(address);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw Error("Use a plain HTTP(S) site URL");
  async function json(url) {
    const response = await fetcher(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw Error("Version endpoint unavailable or requires site credentials");
    return response.json();
  }
  const frontend = await json(new URL("/runtime-version.json", base));
  if (frontend?.frontend?.role !== "frontend" || typeof frontend.backendUrl !== "string") throw Error("Invalid frontend version response");
  const backend = await json(new URL(frontend.backendUrl, base));
  if (backend?.backend?.role !== "backend" || typeof backend.database !== "object") throw Error("Invalid backend version response");
  return { frontend, backend };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) { console.error("Usage: npm run version:check -- http://localhost:5576"); process.exitCode = 1; }
  else try { console.log(JSON.stringify(await inspectRuntimeVersion(process.argv[2]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

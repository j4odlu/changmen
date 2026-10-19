/** Limitless REST — 扩展 background 代发（页面 CORS 不可直连 api.limitless.exchange） */

import { a8PluginGet, hasA8PluginRuntime } from "@changmen/client-core/chrome-plugin/bridge";

export const LIMITLESS_PLUGIN_REQUIRED_MSG =
  "Limitless 采集需要 Gamebet 扩展：加载 changmen/chrome-extension，或使用 Electron 启动（内嵌扩展）";

const PLUGIN_TIMEOUT_MS = 60_000;

function unwrapPluginResponse<T>(raw: unknown): T {
  if (raw instanceof Error)
    throw raw;
  if (raw && typeof raw === "object" && "message" in raw && !("status" in raw) && !("data" in raw)) {
    const message = String((raw as { message?: unknown }).message || "Limitless API 请求失败");
    throw new Error(message);
  }
  if (raw && typeof raw === "object" && "status" in raw && "data" in raw) {
    const res = raw as { status: number; data: unknown };
    if (res.status >= 400) {
      const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "");
      throw new Error(text.slice(0, 160) || `HTTP ${res.status}`);
    }
    return res.data as T;
  }
  if (raw && typeof raw === "object" && "data" in raw) {
    return (raw as { data?: unknown }).data as T;
  }
  return raw as T;
}

function requirePluginRuntime(): void {
  if (!hasA8PluginRuntime())
    throw new Error(LIMITLESS_PLUGIN_REQUIRED_MSG);
}

export async function limitlessPluginGet<T>(
  url: string,
  options?: { headers?: Record<string, string>; timeout?: number },
): Promise<T> {
  requirePluginRuntime();
  const raw = await a8PluginGet(url, { timeout: PLUGIN_TIMEOUT_MS, withCredentials: false, ...options });
  if (raw == null)
    throw new Error("Limitless API 无响应");
  return unwrapPluginResponse<T>(raw);
}

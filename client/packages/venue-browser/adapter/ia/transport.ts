/** 对齐 A8 `wQe` 内 `Zn.get` / `Zn.post`（Chrome 扩展代发，绕过 IA 源站 CORS） */

import { a8PluginGet, a8PluginPost, hasA8PluginRuntime } from "@changmen/client-core/chrome-plugin/bridge";
import type { CollectPlatformInfo } from "@changmen/api-contract";

export const IA_PLUGIN_REQUIRED_MSG =
  "IA 采集需要 Gamebet 扩展（对齐 A8 Zn）：加载 changmen/chrome-extension，或使用 Electron 启动（内嵌扩展）";

function iaGatewayUrl(platform: CollectPlatformInfo, path: string): string {
  const base = (platform.Gateway || "").replace(/\/+$/, "");
  const apiPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${apiPath}`;
}

function iaCollectHeaders(
  platform: CollectPlatformInfo,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    token: platform.Token ?? "",
    ...extra,
  };
}

function unwrap<T>(response: unknown): T {
  if (response && typeof response === "object" && "data" in response) {
    return (response as { data?: unknown }).data as T;
  }
  return response as T;
}

function requirePluginRuntime(): void {
  if (!hasA8PluginRuntime()) throw new Error(IA_PLUGIN_REQUIRED_MSG);
}

/** A8 `Zn.get(\`\${gateway}/api/game/...\`, { headers: { token } })` */
export async function iaCollectGet<T>(platform: CollectPlatformInfo, path: string): Promise<T> {
  requirePluginRuntime();
  if (!platform.Gateway) throw new Error("IA collect platform not configured");
  const url = iaGatewayUrl(platform, path);
  const raw = await a8PluginGet(url, { headers: iaCollectHeaders(platform) });
  return unwrap<T>(raw);
}

/** A8 `Zn.post(\`\${gateway}/api/game/...\`, body, { headers: { token, Content-Type } })` */
export async function iaCollectPost<T>(
  platform: CollectPlatformInfo,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  requirePluginRuntime();
  if (!platform.Gateway) throw new Error("IA collect platform not configured");
  const url = iaGatewayUrl(platform, path);
  const raw = await a8PluginPost(url, body, {
    headers: iaCollectHeaders(platform, { "Content-Type": "application/json" }),
  });
  return unwrap<T>(raw);
}

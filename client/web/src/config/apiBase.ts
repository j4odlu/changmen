/**
 * 生产/预览：API 根地址（不含尾部斜杠）。
 * 空 = 同源相对路径 `/esport/...`（推荐同源部署）。
 *
 * 分离部署示例：VITE_API_BASE=https://api.example.com
 */
export function getApiBase(): string {
  const raw = import.meta.env.VITE_API_BASE;
  return raw && String(raw).trim() ? String(raw).trim().replace(/\/+$/, "") : "";
}

/**
 * 后端托管页面必须与认证 Cookie 同源。
 * 生产 API 使用独立子域时，`__Host-*` Cookie 不会发送给页面站子域。
 */
export function resolveBackendPageUrl(path: string, apiBase = getApiBase()): string {
  const normalizedPath = `/${String(path || "").replace(/^\/+/, "")}`;
  if (!apiBase)
    return normalizedPath;
  try {
    return new URL(normalizedPath, `${apiBase.replace(/\/+$/, "")}/`).toString();
  }
  catch {
    return normalizedPath;
  }
}

export function getMatcherUrl(): string {
  return resolveBackendPageUrl("/matcher/");
}

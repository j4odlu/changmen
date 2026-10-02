import type { ApiEnvelope } from "@changmen/api-contract";
import { buildEsportUrl } from "@changmen/api-contract/urls";
import { authHeaders, post, unwrap } from "@/api/client";
import { getApiBase } from "@/config/apiBase";

const JSON_HEADERS = { "Content-Type": "application/json" };

export async function getClientData<T extends Record<string, unknown>>(key: string) {
  const res = await fetch(buildEsportUrl("Client_GetData", "", getApiBase()), {
    method: "POST",
    credentials: "include",
    headers: { ...JSON_HEADERS, ...authHeaders() },
    body: JSON.stringify({ key }),
  });
  if (!res.ok)
    return null;
  const data = (await res.json()) as Record<string, unknown>;

  if (data.success === 0)
    return null;

  if (data.success === 1) {
    if (data.info && typeof data.info === "object" && !Array.isArray(data.info)) {
      return data.info as T;
    }
    const { success: _s, msg: _m, info: _i, ...rest } = data;
    if (Object.keys(rest).length)
      return rest as T;
  }

  if (Array.isArray(data))
    return data as unknown as T;
  if (Array.isArray(data.collect))
    return data as T;

  // USERCONFIG / CollectConfig / Follow / Message：有数据时后端直接返回裸对象（无 success 包裹）
  if (data && typeof data === "object") {
    return data as T;
  }
  return null;
}

/** ACCOUNT / PROXY 等数组 KV（router 直接返回 JSON 数组） */
export async function getClientDataArray<T>(key: string): Promise<T[]> {
  const res = await fetch(buildEsportUrl("Client_GetData", "", getApiBase()), {
    method: "POST",
    credentials: "include",
    headers: { ...JSON_HEADERS, ...authHeaders() },
    body: JSON.stringify({ key }),
  });
  if (!res.ok)
    throw new Error(`Client_GetData(${key}) HTTP ${res.status}`);
  const data = await res.json();
  if (data?.success === 0)
    throw new Error(data.msg || `Client_GetData(${key}) failed`);
  if (Array.isArray(data))
    return data as T[];
  // 兼容偶发 { success, info: [] } 包裹（直连/代理不一致时）
  if (data && typeof data === "object" && Array.isArray((data as { info?: unknown }).info))
    return (data as { info: T[] }).info;
  return [];
}

export function isEsportSuccess(data: ApiEnvelope<unknown> | null | undefined): boolean {
  return Boolean(data && data.success === 1);
}

export async function saveClientDataDetailed(
  key: string,
  content: string,
): Promise<{ ok: boolean; msg?: string }> {
  try {
    const data = await post<boolean>("Client_SaveData", { key, content });
    if (isEsportSuccess(data))
      return { ok: true };
    return { ok: false, msg: data?.msg || "保存失败" };
  }
  catch (err) {
    return { ok: false, msg: err instanceof Error ? err.message : "保存失败" };
  }
}

export async function saveClientData(key: string, content: string) {
  const result = await saveClientDataDetailed(key, content);
  return result.ok;
}

export async function updateUserSetting(setting: Record<string, unknown>) {
  const data = await post<Record<string, unknown>>("Client_UpdateSetting", { setting });
  return unwrap(data);
}

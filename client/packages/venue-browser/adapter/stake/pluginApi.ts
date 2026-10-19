import { a8PluginPost } from "@changmen/client-core/chrome-plugin/bridge";
import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";

const STAKE_GRAPHQL_PATH = "https://stake.com/_api/graphql";
const STAKE_GRAPHQL_TIMEOUT_MS = 15_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Stake ${label} 超时`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

type PluginAxiosLike = { data?: unknown };

function unwrapPluginEnvelope(response: unknown): Record<string, unknown> {
  if (response && typeof response === "object" && "data" in response) {
    const data = (response as PluginAxiosLike).data;
    if (data && typeof data === "object" && !Array.isArray(data))
      return data as Record<string, unknown>;
    return {};
  }
  if (response && typeof response === "object" && !Array.isArray(response))
    return response as Record<string, unknown>;
  return {};
}

/** 对齐 A8 `im(account)`。空 token 不发空头，避免盖掉 stake.com 标签页 session cookie */
export function stakeAccountHeaders(account: Pick<PlatformAccount, "token">): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-language": "zh",
    "x-operation-name": "CurrencyConfiguration",
    "x-operation-type": "query",
  };
  const token = String(account.token ?? "").trim();
  if (token)
    headers["x-access-token"] = token;
  return headers;
}

/**
 * 对齐 A8 `Zn.post` → `r.data`：保留 GraphQL 顶层 `{ data, errors }`。
 */
export async function stakePluginGraphql(
  label: string,
  body: Record<string, unknown>,
  opts: { tabId: number; headers: Record<string, string> },
): Promise<Record<string, unknown>> {
  const raw = await withTimeout(
    a8PluginPost(`${STAKE_GRAPHQL_PATH}?${label}`, body, {
      tabId: opts.tabId,
      headers: opts.headers,
      timeout: STAKE_GRAPHQL_TIMEOUT_MS,
      platform: "Stake",
      provider: "Stake",
    }),
    STAKE_GRAPHQL_TIMEOUT_MS + 2_000,
    label,
  );
  if (typeof raw === "string" && raw.trim())
    throw new Error(raw);
  const envelope = unwrapPluginEnvelope(raw);
  if (envelope && typeof envelope === "object" && ("data" in envelope || "errors" in envelope)) {
    return envelope;
  }
  return { data: envelope };
}

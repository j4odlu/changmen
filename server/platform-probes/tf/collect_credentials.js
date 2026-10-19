/**
 * TF 采集凭证 — 仅本地：TF_GATEWAY+TF_TOKEN / platforms.json / session。
 * 不再请求 api.a8.to/esport。
 */
import { getPlatform } from "@changmen/storage/platform_storage.js";
import { tryLoadSession } from "./session.js";

function fromPlatformRow(row) {
  return {
    gateway: row.gateway,
    token: row.token,
    betName: row.betName || "(独赢)",
    games: (row.games || []).map(String),
    provider: "TF",
  };
}

export async function getTfA8CollectCredentials() {
  const envGateway = process.env.TF_GATEWAY;
  const envToken = process.env.TF_TOKEN;
  if (envGateway && envToken) {
    return {
      gateway: envGateway,
      token: envToken,
      betName: process.env.TF_BET_NAME || "(独赢)",
      games: tryLoadSession()?.gameIds?.map(String) || [],
      provider: "TF",
    };
  }

  const platform = getPlatform("TF");
  if (platform?.gateway && platform?.token) {
    return fromPlatformRow(platform);
  }

  const session = tryLoadSession();
  if (session?.gateway && session?.token) {
    return {
      gateway: session.gateway,
      token: session.token,
      betName: session.betName || "(独赢)",
      games: session.gameIds || [],
      provider: "TF",
    };
  }

  throw new Error(
    "TF 采集凭证未配置：请设置 TF_GATEWAY+TF_TOKEN 或 platforms.json（TF.gateway/token）",
  );
}

export function clearTfA8CollectCache() {
  /* 本地凭证无远程缓存；保留函数签名兼容旧调用 */
}

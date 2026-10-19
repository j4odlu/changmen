import type { Chain, Transport } from "viem";
import { createPublicClient, fallback, http } from "viem";
import { polygon } from "viem/chains";

/**
 * Polygon RPC（对齐官方 Relayer 示例：`http(process.env.RPC_URL)`）。
 * viem 默认 `polygon.drpc.org` 在部分网络会 eth_call unavailable；
 * 未配置时用公共节点 fallback，仅服务「推导/部署 Deposit Wallet」等读链场景。
 */
export const POLYGON_RPC_URLS = [
  "https://polygon-bor.publicnode.com",
  "https://polygon.llamarpc.com",
  "https://polygon.drpc.org",
] as const;

function readVitePolygonRpcUrl(): string {
  try {
    // Vite / Vitest 会在构建期内联；Node 侧通常无此项
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    return String(env?.VITE_POLYGON_RPC_URL ?? "").trim();
  }
  catch {
    return "";
  }
}

function readConfiguredPolygonRpcUrl(): string {
  let fromProcess = "";
  if (typeof process !== "undefined" && process.env) {
    fromProcess = String(
      process.env.RPC_URL
      || process.env.POLYGON_RPC_URL
      || process.env.POLYMARKET_POLYGON_RPC
      || process.env.VITE_POLYGON_RPC_URL
      || "",
    ).trim();
  }
  return fromProcess || readVitePolygonRpcUrl();
}

export function resolvePolygonRpcUrls(): string[] {
  const configured = readConfiguredPolygonRpcUrl();
  if (!configured)
    return [...POLYGON_RPC_URLS];
  return [configured, ...POLYGON_RPC_URLS.filter(url => url !== configured)];
}

/** 钱包签名 / 读链：多 RPC fallback */
export function createPolygonHttpTransport(): Transport {
  return fallback(resolvePolygonRpcUrls().map(url => http(url)));
}

export function polygonChainForRpc(): Chain {
  const urls = resolvePolygonRpcUrls();
  return {
    ...polygon,
    rpcUrls: {
      ...polygon.rpcUrls,
      default: { http: urls },
    },
  };
}

/**
 * `@polymarket/builder-relayer-client` RelayClient 构造时固定
 * `transport: http()`（只吃 chain.rpcUrls.default.http[0]）。
 * 构造后替换 publicClient，使 deriveDepositWalletAddress 的 eth_call 走 fallback。
 */
export function patchRelayClientPublicClient(client: object, chain: Chain = polygonChainForRpc()): void {
  Reflect.set(client, "publicClient", createPublicClient({
    chain,
    transport: createPolygonHttpTransport(),
  }));
}

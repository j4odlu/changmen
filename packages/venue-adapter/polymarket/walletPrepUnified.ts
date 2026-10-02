/**
 * 统一 SDK（@polymarket/client）钱包准备。
 *
 * - createSecureClient + remoteBuilderSigning（远程 Builder HMAC，契约同旧 remoteBuilderConfig）
 * - 省略 wallet → Deposit Wallet（按需部署）
 * - setupTradingApprovals → 买卖所需 authorize
 *
 * 切换：PM_WALLET_PREP_SDK=unified（默认 legacy）
 * 注意：createSecureClient 会走 CLOB beginAuthentication（校验/派生 apiCreds）；
 * 本机直连 CLOB 不稳时，请先生成凭证再准备，或保持 legacy。
 */

import { normalizePolymarketPrivateKey, POLYMARKET_RELAYER_URL_DEFAULT } from "./depositWallet";
import {
  createPolygonHttpTransport,
  polygonChainForRpc,
  resolvePolygonRpcUrls,
} from "./polygonRpc";

/** 与 relayer.PolymarketRelayerPrepare* 对齐；避免与 relayer.ts 循环依赖 */
export interface WalletPrepUnifiedInput {
  privateKey: string;
  signUrl: string;
  authToken: string;
  getAuthToken?: () => Promise<string>;
  relayerUrl?: string;
  signatureType?: string | number;
  /**
   * 已有 CLOB L2 凭证时传入（字段名 key，对齐 @polymarket/client SecureClientOptions）。
   * 仍会向 CLOB 校验 key 是否有效；网络不可达时会失败。
   */
  credentials?: {
    key: string;
    secret: string;
    passphrase: string;
  };
}

export interface WalletPrepUnifiedResult {
  ok: boolean;
  message: string;
  transactionHash?: string;
  funder?: string;
  skipped?: boolean;
}

function formatUnifiedPrepError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const text = (() => {
    try {
      const parsed = JSON.parse(raw) as { data?: { error?: string }; error?: string };
      return parsed?.data?.error || parsed?.error || raw;
    }
    catch {
      return raw;
    }
  })();
  if (text.includes("does not match auth")) {
    return "Relayer 鉴权地址与账号私钥不一致：Relayer API Key 仅适用于 key 绑定地址 = 私钥地址；changmen 多用户请用服务端 POLY_BUILDER_*（Builder HMAC）";
  }
  if (/approve spender .+ is not in the allowed list/i.test(text)) {
    return "Deposit Wallet 拒绝了对非白名单合约的授权（通常是旧版 V1 Exchange）。请更新客户端后重试账号准备。";
  }
  if (/fetch failed|Failed to fetch|NetworkError|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|cors|CLOB|clob\.polymarket/i.test(text)) {
    return [
      "unified 钱包准备需要本机可达 CLOB（createSecureClient 会校验/派生 API 凭证）。",
      "可先「生成 API Creds」再重试，或改回 PM_WALLET_PREP_SDK=legacy。",
      text,
    ].join(" ");
  }
  return text || "Polymarket Relayer 请求失败（@polymarket/client）";
}

export async function preparePolymarketWalletUnified(
  input: WalletPrepUnifiedInput,
): Promise<WalletPrepUnifiedResult> {
  try {
    return await preparePolymarketWalletUnifiedInner(input);
  }
  catch (err) {
    return { ok: false, message: formatUnifiedPrepError(err) };
  }
}

async function preparePolymarketWalletUnifiedInner(
  input: WalletPrepUnifiedInput,
): Promise<WalletPrepUnifiedResult> {
  const authToken = input.authToken.trim();
  if (!authToken)
    return { ok: false, message: "未登录，无法调用 Relayer 远程签名" };

  const signUrl = input.signUrl.trim();
  if (!signUrl.startsWith("http://") && !signUrl.startsWith("https://"))
    return { ok: false, message: "Relayer 远程签名 URL 必须是绝对地址" };

  const numeric = Number(input.signatureType ?? 3);
  if (numeric !== 3) {
    return {
      ok: false,
      message: "unified SDK 钱包准备目前仅支持 Deposit Wallet（signatureType=3）；Safe/Proxy 请改回 PM_WALLET_PREP_SDK=legacy",
    };
  }

  const [
    { createSecureClient, remoteBuilderSigning, forkEnvironmentConfig },
    { privateKey },
  ] = await Promise.all([
    import("@polymarket/client"),
    import("@polymarket/client/viem"),
  ]);

  const pk = normalizePolymarketPrivateKey(input.privateKey);
  const signer = privateKey(pk, {
    chain: polygonChainForRpc(),
    transport: createPolygonHttpTransport(),
  });

  const relayerRest = (input.relayerUrl?.trim() || POLYMARKET_RELAYER_URL_DEFAULT).replace(/\/+$/, "");
  // SDK production 默认 rpc=polygon.drpc.org，部分网络 eth_call 会挂；与 legacy patch 对齐
  const environment = forkEnvironmentConfig({
    name: "changmen-wallet-prep",
    rpc: resolvePolygonRpcUrls()[0],
    relayer: { rest: relayerRest },
  });

  const baseOpts = {
    signer,
    environment,
    apiKey: remoteBuilderSigning({
      url: signUrl,
      headers: input.getAuthToken ? async () => ({ Authorization: `Bearer ${await input.getAuthToken!()}` }) : {
        Authorization: `Bearer ${authToken}`,
      },
    }),
  };
  const creds = input.credentials;
  // ApiKeyCreds 使用 branded string；账号侧存的是普通 string，此处断言接入 SDK
  const client = await createSecureClient(
    (creds?.key && creds.secret && creds.passphrase
      ? {
          ...baseOpts,
          credentials: {
            key: creds.key,
            secret: creds.secret,
            passphrase: creds.passphrase,
          },
        }
      : baseOpts) as Parameters<typeof createSecureClient>[0],
  );

  const funder = String(client.account.wallet);
  await client.setupTradingApprovals();

  return {
    ok: true,
    message: "Polymarket Deposit Wallet 已就绪并完成交易授权（@polymarket/client）",
    funder,
  };
}

import { encodeFunctionData, maxUint256, type Hex } from "viem";
import {
  POLYMARKET_RELAYER_URL_DEFAULT,
  POLYGON_CHAIN_ID,
} from "./depositWallet";
import { POLYGON_POLYMARKET, polymarketTradeSpenders } from "./contracts";
import { preparePolymarketWalletUnified } from "./walletPrepUnified";

export {
  buildDepositWalletApprovalCalls,
  normalizePolymarketPrivateKey,
  derivePolymarketDepositWalletAddress,
  resolvePolymarketDepositWalletFromPrivateKey,
  resolvePolymarketSignerAddress,
} from "./depositWallet";

export { POLYGON_POLYMARKET, polymarketTradeSpenders } from "./contracts";

interface Transaction { to: string; data: string; value: string }

type SignatureType = string | number | undefined;

export interface PolymarketRelayerPrepareInput {
  privateKey: string;
  /** 远程签名 URL，如 `${apiBase}/api/polymarket/relayer/sign` */
  signUrl: string;
  /** 旧 JWT；Cookie 登录使用 getAuthHeaders。 */
  authToken?: string;
  getAuthToken?: () => Promise<string>;
  getAuthHeaders?: () => Promise<Record<string, string>>;
  relayerUrl?: string;
  signatureType?: SignatureType;
  /** unified 路径可选：已有 CLOB L2 凭证，避免 createSecureClient 再派生 */
  credentials?: {
    key: string;
    secret: string;
    passphrase: string;
  };
}

export interface PolymarketRelayerPrepareResult {
  ok: boolean;
  message: string;
  transactionHash?: string;
  funder?: string;
  skipped?: boolean;
}

/** @deprecated 用 POLYGON_POLYMARKET；保留别名避免外部 import 断裂 */
const POLYGON = POLYGON_POLYMARKET;

const ERC20_APPROVE_ABI = [
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const ERC1155_SET_APPROVAL_FOR_ALL_ABI = [
  {
    name: "setApprovalForAll",
    type: "function",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

function createApproveTransaction(tokenAddress: string, spenderAddress: string): Transaction {
  return {
    to: tokenAddress,
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [spenderAddress as Hex, maxUint256],
    }),
    value: "0",
  };
}

function createSetApprovalForAllTransaction(operatorAddress: string): Transaction {
  return {
    to: POLYGON.CTF,
    data: encodeFunctionData({
      abi: ERC1155_SET_APPROVAL_FOR_ALL_ABI,
      functionName: "setApprovalForAll",
      args: [operatorAddress as Hex, true],
    }),
    value: "0",
  };
}

/**
 * 钱包准备：买（collateral approve）+ 卖（CTF setApprovalForAll）。
 * 每个 spender 一次即可，覆盖全部市场 token。
 * @deprecated Deposit Wallet 请用 buildDepositWalletApprovalCalls
 */
export function buildStandardApprovalTransactions(): Transaction[] {
  const spenders = polymarketTradeSpenders();
  const txs: Transaction[] = [
    createApproveTransaction(POLYGON.USDC, POLYGON.CTF),
    createApproveTransaction(POLYGON.PUSD, POLYGON.CTF),
  ];
  for (const spender of spenders) {
    txs.push(createApproveTransaction(POLYGON.USDC, spender));
    txs.push(createApproveTransaction(POLYGON.PUSD, spender));
    txs.push(createSetApprovalForAllTransaction(spender));
  }
  return txs;
}

function formatRelayerError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const text = (() => {
    try {
      const parsed = JSON.parse(raw) as { data?: { error?: string } };
      return parsed?.data?.error || raw;
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
  return text || "Polymarket Relayer 请求失败";
}

export async function preparePolymarketWallet(
  input: PolymarketRelayerPrepareInput,
): Promise<PolymarketRelayerPrepareResult> {
  try {
    return await preparePolymarketWalletInner(input);
  }
  catch (err) {
    return { ok: false, message: formatRelayerError(err) };
  }
}

async function preparePolymarketWalletInner(
  input: PolymarketRelayerPrepareInput,
): Promise<PolymarketRelayerPrepareResult> {
  const signUrl = input.signUrl.trim();
  if (!signUrl.startsWith("http://") && !signUrl.startsWith("https://"))
    return { ok: false, message: "Relayer 远程签名 URL 必须是绝对地址" };

  return preparePolymarketWalletUnified(input);
}

export async function fetchPolymarketRelayerStatus(
  apiBase: string,
  authToken: string,
  authHeaders?: Record<string, string>,
): Promise<{ configured: boolean; relayerUrl?: string }> {
  const base = apiBase.replace(/\/+$/, "");
  const url = `${base}/api/polymarket/relayer/status`;
  const res = await fetch(url, {
    credentials: authHeaders?.["X-Changmen-Auth"] === "cookie" ? "include" : "same-origin",
    headers: {
      ...(authHeaders || { token: authToken }),
      Accept: "application/json",
    },
  });
  if (!res.ok)
    return { configured: false };
  return res.json() as Promise<{ configured: boolean; relayerUrl?: string }>;
}

export { POLYGON_CHAIN_ID, POLYMARKET_RELAYER_URL_DEFAULT };

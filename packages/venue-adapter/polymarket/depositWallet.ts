import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { SessionBuilderConfig } from "./sessionBuilderConfig";
import {
  RelayClient,
  RelayerTxType,
  type DepositWalletCall,
} from "@polymarket/builder-relayer-client";
import { encodeFunctionData, maxUint256, type Hex } from "viem";
import { POLYGON_POLYMARKET, polymarketTradeSpenders } from "./contracts";
import {
  createPolygonHttpTransport,
  patchRelayClientPublicClient,
  polygonChainForRpc,
} from "./polygonRpc";

export const POLYMARKET_RELAYER_URL_DEFAULT = "https://relayer-v2.polymarket.com";
export const POLYGON_CHAIN_ID = 137;

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

export function normalizePolymarketPrivateKey(raw: string): Hex {
  const key = raw.trim();
  const hex = key.startsWith("0x") ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex))
    throw new Error("Polymarket 私钥格式不正确，应为 64 位 hex");
  return hex as Hex;
}

export async function resolvePolymarketSignerAddress(privateKey: string): Promise<string> {
  const accounts = await import("viem/accounts");
  return accounts.privateKeyToAccount(normalizePolymarketPrivateKey(privateKey)).address;
}

function joinSignUrl(signUrl: string): string {
  const url = signUrl.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://"))
    throw new Error("Relayer 远程签名 URL 必须是绝对地址");
  return url;
}

export interface PolymarketRelayClientInput {
  privateKey: string;
  signUrl?: string;
  authToken?: string;
  getAuthToken?: () => Promise<string>;
  relayerUrl?: string;
  relayTxType?: RelayerTxType;
}

/**
 * [官方] docs / README：`transport: http(process.env.RPC_URL)`，勿依赖 viem 默认 polygon.drpc.org。
 * RelayClient 第 6 参 `options.chain` 供其内部 publicClient 读 rpcUrls。
 */
export async function createPolymarketRelayClient(
  input: PolymarketRelayClientInput,
): Promise<RelayClient> {
  const privateKey = normalizePolymarketPrivateKey(input.privateKey);
  const relayerUrl = (input.relayerUrl?.trim() || POLYMARKET_RELAYER_URL_DEFAULT).replace(/\/+$/, "");
  const [
    accounts,
    viem,
  ] = await Promise.all([
    import("viem/accounts"),
    import("viem"),
  ]);
  const account = accounts.privateKeyToAccount(privateKey);
  const chain = polygonChainForRpc();
  const wallet = viem.createWalletClient({
    account,
    chain,
    transport: createPolygonHttpTransport(),
  });
  const signUrl = input.signUrl?.trim();
  const authToken = input.authToken?.trim();
  const builderConfig = signUrl && authToken
    ? input.getAuthToken ? new SessionBuilderConfig(joinSignUrl(signUrl), input.getAuthToken) : new BuilderConfig({
        remoteBuilderConfig: {
          url: joinSignUrl(signUrl),
          token: authToken,
        },
      })
    : undefined;
  const client = new RelayClient(
    relayerUrl,
    POLYGON_CHAIN_ID,
    wallet,
    builderConfig,
    input.relayTxType,
    { chain },
  );
  // SDK 内 publicClient 无 fallback；替换后 deriveDepositWalletAddress eth_call 才走多节点
  patchRelayClientPublicClient(client, chain);
  return client;
}

/** [官方] Prefer `client.deriveDepositWalletAddress()`（含 beacon / UUPS 判断） */
export async function derivePolymarketDepositWalletAddress(input: {
  privateKey: string;
  relayerUrl?: string;
}): Promise<string> {
  const client = await createPolymarketRelayClient({
    privateKey: input.privateKey,
    relayerUrl: input.relayerUrl,
  });
  return client.deriveDepositWalletAddress();
}

export async function resolvePolymarketDepositWalletFromPrivateKey(input: {
  privateKey: string;
  relayerUrl?: string;
}): Promise<{ walletAddress: string; funder: string }> {
  const walletAddress = await resolvePolymarketSignerAddress(input.privateKey);
  const funder = await derivePolymarketDepositWalletAddress(input);
  return { walletAddress, funder };
}

function createDepositWalletApproveCall(tokenAddress: string, spenderAddress: string): DepositWalletCall {
  return {
    target: tokenAddress,
    value: "0",
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [spenderAddress as Hex, maxUint256],
    }),
  };
}

function createDepositWalletSetApprovalForAllCall(operatorAddress: string): DepositWalletCall {
  return {
    target: POLYGON_POLYMARKET.CTF,
    value: "0",
    data: encodeFunctionData({
      abi: ERC1155_SET_APPROVAL_FOR_ALL_ABI,
      functionName: "setApprovalForAll",
      args: [operatorAddress as Hex, true],
    }),
  };
}

/** Deposit Wallet batch：买（collateral approve）+ 卖（CTF setApprovalForAll） */
export function buildDepositWalletApprovalCalls(): DepositWalletCall[] {
  const spenders = polymarketTradeSpenders();
  const calls: DepositWalletCall[] = [
    createDepositWalletApproveCall(POLYGON_POLYMARKET.USDC, POLYGON_POLYMARKET.CTF),
    createDepositWalletApproveCall(POLYGON_POLYMARKET.PUSD, POLYGON_POLYMARKET.CTF),
  ];
  for (const spender of spenders) {
    calls.push(createDepositWalletApproveCall(POLYGON_POLYMARKET.USDC, spender));
    calls.push(createDepositWalletApproveCall(POLYGON_POLYMARKET.PUSD, spender));
    calls.push(createDepositWalletSetApprovalForAllCall(spender));
  }
  return calls;
}

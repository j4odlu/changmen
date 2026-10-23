import { encodeFunctionData, maxUint256, type Hex } from "viem";
import { POLYGON_POLYMARKET, polymarketTradeSpenders } from "./contracts";
import { deriveDepositWalletAddress } from "./depositWalletAddress";

export const POLYMARKET_RELAYER_URL_DEFAULT = "https://relayer-v2.polymarket.com";
export const POLYGON_CHAIN_ID = 137;

export interface DepositWalletCall {
  target: string;
  value: string;
  data: string;
}

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

/** [changmen 扩展] 与官方 SDK 相同的 beacon / UUPS 判断，旧 SDK 不进入地址派生路径。 */
export async function derivePolymarketDepositWalletAddress(input: {
  privateKey: string;
  relayerUrl?: string;
}): Promise<string> {
  const owner = await resolvePolymarketSignerAddress(input.privateKey);
  return deriveDepositWalletAddress(owner as Hex);
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

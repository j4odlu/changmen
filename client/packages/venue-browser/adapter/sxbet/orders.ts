import { Wallet, ZeroAddress, ZeroHash, getAddress, hexlify, randomBytes } from "ethers";
import {
  SXBET_CHAIN_ID,
  SXBET_USDC,
  fetchSxMetadata,
  postSxFillOrder,
  resolveSxUsdcAddress,
  type SxFillResult,
  type SxMetadata,
} from "./api";

const FILL_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  Details: [
    { name: "action", type: "string" },
    { name: "market", type: "string" },
    { name: "betting", type: "string" },
    { name: "stake", type: "string" },
    { name: "worstOdds", type: "string" },
    { name: "worstReturning", type: "string" },
    { name: "fills", type: "FillObject" },
  ],
  FillObject: [
    { name: "stakeWei", type: "string" },
    { name: "marketHash", type: "string" },
    { name: "baseToken", type: "string" },
    { name: "desiredOdds", type: "string" },
    { name: "oddsSlippage", type: "uint256" },
    { name: "isTakerBettingOutcomeOne", type: "bool" },
    { name: "fillSalt", type: "uint256" },
    { name: "beneficiary", type: "address" },
    { name: "beneficiaryType", type: "uint8" },
    { name: "cashOutTarget", type: "bytes32" },
  ],
};

export function sxUsdcToWei(usdc: number): string {
  if (!Number.isFinite(usdc) || usdc <= 0)
    throw new Error(`无效 USDC 金额 ${usdc}`);
  return BigInt(Math.round(usdc * 1e6)).toString();
}

export function sxWeiToUsdc(wei: string | number | undefined): number {
  const raw = Number(wei);
  if (!Number.isFinite(raw) || raw < 0)
    return 0;
  return raw / 1e6;
}

/** 官方 trades.netReturn 示例为人类可读 USDC（如 "2.035617"），不是 wei */
export function parseSxTradeNetReturnUsdc(raw: string | number | undefined): number {
  const s = String(raw ?? "").trim();
  if (!s)
    return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function parseSxTradeStakeUsdc(trade: {
  stake?: string;
  normalizedStake?: number | string;
}): number {
  const normalized = Number(trade.normalizedStake);
  if (Number.isFinite(normalized) && normalized > 0)
    return normalized;
  return sxWeiToUsdc(trade.stake);
}

export function walletFromSxPrivateKey(privateKey: string): Wallet {
  const key = String(privateKey || "").trim();
  if (!key)
    throw new Error("SXBet 缺少私钥");
  return new Wallet(key.startsWith("0x") ? key : `0x${key}`);
}

export function checksumSxAddress(address: string): string {
  return getAddress(String(address || "").trim());
}

export async function loadSxFillContext(meta?: SxMetadata | null): Promise<{
  meta: SxMetadata;
  chainId: number;
  domainVersion: string;
  verifyingContract: string;
  baseToken: string;
}> {
  const resolved = meta ?? await fetchSxMetadata();
  const verifyingContract = String(resolved.EIP712FillHasher ?? "").trim();
  if (!verifyingContract)
    throw new Error("SXBet metadata 缺少 EIP712FillHasher");
  return {
    meta: resolved,
    chainId: SXBET_CHAIN_ID,
    domainVersion: String(resolved.domainVersion || "6.0"),
    verifyingContract,
    baseToken: resolveSxUsdcAddress(resolved) || SXBET_USDC,
  };
}

export interface SxFillOrderInput {
  privateKey: string;
  marketHash: string;
  isTakerBettingOutcomeOne: boolean;
  /** USDC 人类可读金额 */
  stakeUsdc: number;
  /** taker 视角协议赔率（implied * 1e20） */
  desiredOdds: string;
  oddsSlippage?: number;
  meta?: SxMetadata | null;
}

export interface SxFillOrderResult {
  fillHash: string;
  isPartialFill: boolean;
  totalFilled: string;
  averageOdds: string;
  taker: string;
  request: Record<string, unknown>;
  response: unknown;
}

/** EIP-712 签名 + POST /orders/fill/v2（taker 吃单） */
export async function fillSxOrder(input: SxFillOrderInput): Promise<SxFillOrderResult> {
  const wallet = walletFromSxPrivateKey(input.privateKey);
  const ctx = await loadSxFillContext(input.meta);
  const marketHash = String(input.marketHash || "").trim();
  if (!marketHash)
    throw new Error("缺少 marketHash");
  const stakeWei = sxUsdcToWei(input.stakeUsdc);
  const desiredOdds = String(input.desiredOdds || "").trim();
  if (!desiredOdds || desiredOdds === "0")
    throw new Error("缺少 desiredOdds");
  const oddsSlippage = Math.max(0, Math.min(100, Math.floor(Number(input.oddsSlippage) || 0)));
  const fillSalt = BigInt(hexlify(randomBytes(32))).toString();
  const isTakerBettingOutcomeOne = input.isTakerBettingOutcomeOne === true;

  const domain = {
    name: "SX Bet",
    version: ctx.domainVersion,
    chainId: ctx.chainId,
    verifyingContract: ctx.verifyingContract,
  };

  const message = {
    action: "N/A",
    market: marketHash,
    betting: "N/A",
    stake: "N/A",
    worstOdds: "N/A",
    worstReturning: "N/A",
    fills: {
      stakeWei,
      marketHash,
      baseToken: ctx.baseToken,
      desiredOdds,
      oddsSlippage,
      isTakerBettingOutcomeOne,
      fillSalt,
      beneficiary: ZeroAddress,
      beneficiaryType: 0,
      cashOutTarget: ZeroHash,
    },
  };

  const takerSig = await wallet.signTypedData(domain, FILL_TYPES, message);
  const request = {
    market: marketHash,
    baseToken: ctx.baseToken,
    isTakerBettingOutcomeOne,
    stakeWei,
    desiredOdds,
    oddsSlippage,
    taker: checksumSxAddress(wallet.address),
    takerSig,
    fillSalt,
  };

  const res = await postSxFillOrder(request);
  if (String(res?.status ?? "").toLowerCase() !== "success") {
    const code = String(res?.errorCode ?? res?.message ?? "fill_failed");
    throw new Error(`SXBet fill 失败: ${code}`);
  }
  const data = (res?.data ?? {}) as SxFillResult;
  const fillHash = String(data.fillHash ?? "").trim();
  if (!fillHash)
    throw new Error("SXBet fill 成功但缺少 fillHash");

  return {
    fillHash,
    isPartialFill: data.isPartialFill === true,
    totalFilled: String(data.totalFilled ?? stakeWei),
    averageOdds: String(data.averageOdds ?? desiredOdds),
    taker: request.taker,
    request,
    response: res,
  };
}

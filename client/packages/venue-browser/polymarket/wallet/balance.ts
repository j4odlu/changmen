import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { AccountBalanceResult } from "@changmen/client-core/contract";
import { POLYMARKET_CLOB_API } from "../api";
import { parseTokenConfig, resolveSignatureType } from "../auth/l2Auth";
import { polymarketPluginGet } from "../transport/transport";
import { POLYGON_POLYMARKET } from "./contracts";

const BALANCE_PATH = "/balance-allowance";
const COLLATERAL_DECIMALS = 1_000_000;

interface PolymarketBalanceAllowanceResponse {
  balance?: string | number;
}

function balanceQueryPath(signatureType: string | number | undefined): string {
  const params = new URLSearchParams({ asset_type: "COLLATERAL" });
  if (signatureType !== undefined && signatureType !== null && String(signatureType).trim())
    params.set("signature_type", String(signatureType));
  return `${BALANCE_PATH}?${params.toString()}`;
}

/**
 * 已保存 PM 账号余额：复用统一 HTTP transport。
 * official 可达时 L2 GET 本机直连优先（1.5s），失败仅本次回退 VPS；不切全局模式。
 */
export async function fetchPolymarketBalanceViaTransport(
  account: PlatformAccount,
): Promise<AccountBalanceResult | undefined> {
  const config = parseTokenConfig(account.token);
  const requestPath = balanceQueryPath(resolveSignatureType(config));
  const gateway = String(account.gateway || POLYMARKET_CLOB_API).replace(/\/+$/, "");
  const data = await polymarketPluginGet<PolymarketBalanceAllowanceResponse>(
    `${gateway}${requestPath}`,
    { account, l2Path: BALANCE_PATH },
  );
  const raw = Number(data?.balance);
  if (!Number.isFinite(raw))
    return undefined;
  return {
    balance: raw / COLLATERAL_DECIMALS,
    currency: "USDT",
  };
}

/** 授权后/卖出前按协议刷新仓位缓存；CLOB 的两套持仓账本不能混用。 */
export async function refreshPolymarketPositionAllowance(account: PlatformAccount, assetId: string, protocol: 2 | 3, negRisk = false): Promise<void> {
  if (!/^\d+$/.test(assetId) || (protocol !== 2 && protocol !== 3))
    throw new Error("PM 仓位资产或协议无效");
  const gateway = String(account.gateway || POLYMARKET_CLOB_API).replace(/\/+$/, "");
  const signatureType = Number(resolveSignatureType(parseTokenConfig(account.token)) ?? 0);
  if (![0, 1, 2, 3].includes(signatureType)) throw new Error("PM 钱包签名类型无效");
  const params = new URLSearchParams({ asset_type: protocol === 3 ? "CONDITIONAL-V2" : "CONDITIONAL", token_id: assetId,
    signature_type: String(signatureType) });
  const result = await polymarketPluginGet<{ error?: string } | null>(`${gateway}${BALANCE_PATH}/update?${params}`, { account, l2Path: `${BALANCE_PATH}/update` });
  if (result?.error) throw new Error(`PM 仓位授权缓存刷新失败：${result.error}`);
  const cache = await polymarketPluginGet<{ allowances?: Record<string, string> }>(`${gateway}${BALANCE_PATH}?${params}`, { account, l2Path: BALANCE_PATH });
  const exchange = protocol === 3 ? POLYGON_POLYMARKET.CTF_EXCHANGE_V3
    : negRisk ? POLYGON_POLYMARKET.NEG_RISK_EXCHANGE : POLYGON_POLYMARKET.CTF_EXCHANGE;
  const value = Object.entries(cache?.allowances ?? {}).find(([address]) => address.toLowerCase() === exchange.toLowerCase())?.[1];
  if (typeof value !== "string" || !/^\d+$/.test(value) || BigInt(value) <= 0n)
    throw new Error("PM 仓位授权缓存尚未确认，请重新准备账号后重试");
}

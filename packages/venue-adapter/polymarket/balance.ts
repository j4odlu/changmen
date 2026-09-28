import type { PlatformAccount } from "@changmen/client-core/models/platformAccount";
import type { AccountBalanceResult } from "../contract";
import { POLYMARKET_CLOB_API } from "./api";
import { parseTokenConfig, resolveSignatureType } from "./l2Auth";
import { polymarketPluginGet } from "./transport";

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

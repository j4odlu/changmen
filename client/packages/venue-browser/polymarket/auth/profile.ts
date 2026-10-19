/**
 * [changmen 扩展] Polymarket 公开资料：
 * GET https://gamma-api.polymarket.com/public-profile?address=...
 * @see https://docs.polymarket.com/api-reference/profiles/get-public-profile-by-wallet-address
 */
import { POLYMARKET_GAMMA_API } from "../api";
import {
  normalizeEthAddress,
  parseTokenConfig,
  resolveFunder,
  type PolymarketTokenConfig,
} from "./l2Auth";
import { polymarketPluginGet } from "../transport/transport";

export interface PolymarketPublicProfile {
  name?: string | null;
  pseudonym?: string | null;
  proxyWallet?: string | null;
  displayUsernamePublic?: boolean | null;
  users?: Array<{ id?: string | null }> | null;
}

export interface PolymarketVenueIdentity {
  venueMemberId: string;
  venueAccountName: string;
  proxyWallet?: string;
}

/** 查资料用的地址：优先 funder（proxy），否则 walletAddress */
export function resolvePolymarketProfileAddress(
  config: PolymarketTokenConfig | string | undefined,
): string {
  const parsed = typeof config === "string" ? parseTokenConfig(config) : (config ?? {});
  return normalizeEthAddress(resolveFunder(parsed))
    || normalizeEthAddress(parsed.walletAddress || parsed.address);
}

export function mapPolymarketPublicProfile(
  profile: PolymarketPublicProfile | null | undefined,
): PolymarketVenueIdentity | undefined {
  if (!profile || typeof profile !== "object")
    return undefined;
  const venueMemberId = String(profile.users?.[0]?.id ?? "").trim();
  const venueAccountName = String(profile.name || profile.pseudonym || "").trim();
  if (!venueMemberId && !venueAccountName)
    return undefined;
  const proxyWallet = normalizeEthAddress(profile.proxyWallet || undefined) || undefined;
  return {
    venueMemberId: venueMemberId || proxyWallet || "",
    venueAccountName: venueAccountName || venueMemberId || proxyWallet || "",
    proxyWallet,
  };
}

export async function fetchPolymarketPublicProfile(
  address: string,
): Promise<PolymarketPublicProfile | undefined> {
  const addr = normalizeEthAddress(address);
  if (!addr)
    return undefined;
  const url = `${POLYMARKET_GAMMA_API}/public-profile?address=${encodeURIComponent(addr)}`;
  try {
    return await polymarketPluginGet<PolymarketPublicProfile>(url);
  }
  catch (err) {
    console.warn("[Polymarket] public-profile failed", addr, err);
    return undefined;
  }
}

/** 从 token 解析地址并拉取 venueMemberId / venueAccountName */
export async function resolvePolymarketVenueIdentityFromToken(
  token: string | undefined,
): Promise<PolymarketVenueIdentity | undefined> {
  const address = resolvePolymarketProfileAddress(token);
  if (!address)
    return undefined;
  const profile = await fetchPolymarketPublicProfile(address);
  return mapPolymarketPublicProfile(profile);
}

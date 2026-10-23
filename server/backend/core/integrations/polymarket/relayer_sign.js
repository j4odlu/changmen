import {
  getPolymarketRelayerAuthMode,
  isPolymarketRelayerConfigured,
  loadPolymarketRelayerApiKeyAuth,
} from "./relayer_config.js";
import { signPolymarketRelayerRequestUnified } from "./relayer_sign_unified.js";

/** 兼容旧状态 API；Relayer HMAC 统一使用官方 ESM SDK。 */
export function resolvePolymarketRelayerSignSdk() {
  return "unified";
}

/**
 * 返回 Relayer 请求头。SDK remoteBuilderConfig / remoteBuilderSigning 会 POST 到此逻辑。
 * - relayer_api_key：固定两 header，无需 HMAC
 * - builder_hmac：按 method/path/body 算 POLY_BUILDER_* 签名
 *
 * @param {{ method?: string, path?: string, body?: string, timestamp?: number }} payload
 * @returns {Promise<{ ok: true, headers: Record<string, string> } | { ok: false, msg: string }>}
 */
export async function signPolymarketRelayerRequest(payload) {
  const mode = getPolymarketRelayerAuthMode();
  if (mode === "relayer_api_key") {
    const relayerHeaders = loadPolymarketRelayerApiKeyAuth();
    if (relayerHeaders)
      return { ok: true, headers: { ...relayerHeaders } };
  }

  return signPolymarketRelayerRequestUnified(payload);
}

export function getPolymarketRelayerPublicStatus() {
  return {
    configured: isPolymarketRelayerConfigured(),
    authMode: getPolymarketRelayerAuthMode(),
    signSdk: resolvePolymarketRelayerSignSdk(),
  };
}

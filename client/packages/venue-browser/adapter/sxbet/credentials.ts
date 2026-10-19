/** SX Bet 账号凭证：私钥签名下单；API key 仅用于 Centrifugo WS */

export interface SxBetTokenConfig {
  privateKey?: string;
  private_key?: string;
  apiKey?: string;
  api_key?: string;
  address?: string;
  walletAddress?: string;
  wallet?: string;
}

function parseJsonObject(text: string | undefined): SxBetTokenConfig | undefined {
  if (!text)
    return undefined;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed as SxBetTokenConfig : undefined;
  }
  catch {
    return undefined;
  }
}

export function parseSxBetTokenConfig(raw: string | undefined): SxBetTokenConfig {
  const text = raw?.trim();
  if (!text)
    return {};
  // 纯私钥 / 纯 API key（非 JSON）
  if (!text.startsWith("{")) {
    const hex = text.startsWith("0x") || text.startsWith("0X") ? text.slice(2) : text;
    // 64 hex chars = 32-byte secp256k1 private key（可无 0x 前缀）
    if (/^[0-9a-fA-F]{64}$/.test(hex))
      return { privateKey: text.startsWith("0x") || text.startsWith("0X") ? text : `0x${hex}` };
    return { apiKey: text };
  }
  return parseJsonObject(text) ?? {};
}

export function resolveSxBetPrivateKey(config: SxBetTokenConfig): string {
  const key = String(config.privateKey ?? config.private_key ?? "").trim();
  if (!key)
    return "";
  return key.startsWith("0x") ? key : `0x${key}`;
}

export function resolveSxBetApiKey(config: SxBetTokenConfig): string {
  return String(config.apiKey ?? config.api_key ?? "").trim();
}

export function resolveSxBetConfiguredAddress(config: SxBetTokenConfig): string {
  return String(config.address ?? config.walletAddress ?? config.wallet ?? "").trim();
}

import { PREDICT_FUN_API } from "./api";
import { predictFunHttpGet, predictFunHttpPost, resolvePredictFunApiKey } from "./transport";

interface PredictAuthMessageResponse {
  success?: boolean;
  data?: { message?: string };
}

interface PredictAuthTokenResponse {
  success?: boolean;
  data?: { token?: string };
}

const JWT_CACHE_MS = 50 * 60_000;
const jwtCache = new Map<string, { token: string; expiresAt: number }>();

function predictApiHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = resolvePredictFunApiKey();
  if (apiKey)
    headers["x-api-key"] = apiKey;
  return headers;
}

function cacheKey(signer: string): string {
  return `${PREDICT_FUN_API}:${signer.toLowerCase()}`;
}

export function clearPredictFunJwtCache(signer?: string): void {
  if (!signer) {
    jwtCache.clear();
    return;
  }
  jwtCache.delete(cacheKey(signer));
}

/** [Predict 官方] GET /v1/auth/message → 签名 → POST /v1/auth → JWT */
export async function fetchPredictFunJwt(params: {
  signer: string;
  signMessage: (message: string) => Promise<string>;
}): Promise<string> {
  const signer = String(params.signer ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(signer))
    throw new Error("Predict.fun 无效 signer 地址");

  const cached = jwtCache.get(cacheKey(signer));
  if (cached && cached.expiresAt > Date.now())
    return cached.token;

  const messageRes = await predictFunHttpGet<PredictAuthMessageResponse>(
    `${PREDICT_FUN_API}/v1/auth/message`,
    predictApiHeaders(),
  );
  const message = String(messageRes?.data?.message ?? "").trim();
  if (!message)
    throw new Error("Predict.fun auth/message 无 message");

  const signature = await params.signMessage(message);
  const jwtRes = await predictFunHttpPost<PredictAuthTokenResponse>(
    `${PREDICT_FUN_API}/v1/auth`,
    { signer, message, signature },
    predictApiHeaders(),
  );
  const token = String(jwtRes?.data?.token ?? "").trim();
  if (!token)
    throw new Error("Predict.fun auth 未返回 JWT");

  jwtCache.set(cacheKey(signer), { token, expiresAt: Date.now() + JWT_CACHE_MS });
  return token;
}

export function predictFunJwtHeaders(jwt: string): Record<string, string> {
  return {
    ...predictApiHeaders(),
    Authorization: `Bearer ${jwt}`,
    "Content-Type": "application/json",
  };
}

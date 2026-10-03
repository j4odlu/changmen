import { computeHmac, decodeBase64, encodeBase64, toUtf8Bytes } from "ethers";

/** Browser equivalent of builder-signing-sdk's synchronous Node HMAC helper. */
export function buildHmacSignature(
  secret: string,
  timestamp: number,
  method: string,
  requestPath: string,
  body?: string,
): string {
  const message = `${timestamp}${method}${requestPath}${body ?? ""}`;
  const signature = computeHmac("sha256", decodeBase64(secret), toUtf8Bytes(message));
  // The SDK uses URL-safe base64 while retaining the '=' padding.
  return encodeBase64(signature).replace(/\+/g, "-").replace(/\//g, "_");
}

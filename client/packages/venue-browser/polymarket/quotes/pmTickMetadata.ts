import type { PmTickSizeResponse } from "../pmTickMetadata";
export * from "../pmTickMetadata";

export async function fetchPmTickBufferTickSize(tokenId: string): Promise<PmTickSizeResponse> {
  const { pmTransportHttpGet } = await import("../transport/pmTransport");
  const { POLYMARKET_CLOB_API } = await import("../api");
  const id = String(tokenId).trim();
  if (!id) throw new Error("tokenId 必填");
  const params = new URLSearchParams({ token_id: id });
  return pmTransportHttpGet<PmTickSizeResponse>(`${POLYMARKET_CLOB_API}/tick-size?${params.toString()}`);
}

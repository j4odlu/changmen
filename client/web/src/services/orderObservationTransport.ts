import type { ApiEnvelope } from "@changmen/api-contract";
import type { OrderObservationEvent } from "@changmen/shared/order_observation";
import { buildEsportUrl } from "@changmen/api-contract/urls";
import { a8Axios } from "@changmen/client-core/shared/a8Axios";
import { OBSERVATION_TITLE } from "@changmen/shared/order_observation";
import { authHeaders, getAuthSessionVersion, isAuthSessionCurrent, isAuthTransitionPending } from "@/api/client";
import { getApiBase } from "@/config/apiBase";

/** [changmen 扩展] 旁路请求不刷新 token、不清会话、不修改 API 延迟样本。 */
export async function uploadObservationBatch(ownerUserId: string, events: OrderObservationEvent[], owner: () => string): Promise<string[]> {
  const version = getAuthSessionVersion();
  if (owner() !== ownerUserId || !isAuthSessionCurrent(version) || isAuthTransitionPending())
    return [];
  const response = await a8Axios.post<ApiEnvelope<{ accepted: string[] }>>(
    buildEsportUrl("Client_SaveUserLog", "", getApiBase()),
    { title: OBSERVATION_TITLE, data: JSON.stringify({ ownerUserId, events }) },
    { headers: { "Content-Type": "application/x-www-form-urlencoded;", ...authHeaders() }, withCredentials: true, timeout: 10_000 },
  );
  if (owner() !== ownerUserId || !isAuthSessionCurrent(version))
    return [];
  if (response.data.success !== 1)
    throw new Error("旁路事件上传未确认");
  return Array.isArray(response.data.info?.accepted) ? response.data.info.accepted : [];
}

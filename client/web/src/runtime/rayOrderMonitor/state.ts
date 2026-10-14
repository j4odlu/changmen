/** [changmen 扩展] 原单监控的只读展示状态，按用户、账号、单号隔离。 */
import { reactive } from "vue";

export interface RayMonitoringState { phase: "watching" | "closed"; status?: string; error?: string; updatedAt: number }
export const rayMonitoring = reactive({ owner: "", orders: new Map<string, RayMonitoringState>() });
export function setRayMonitoring(owner: string, player: number, id: string | null, state: Omit<RayMonitoringState, "updatedAt">): void {
  if (!id)
    return;
  if (rayMonitoring.owner !== owner) { rayMonitoring.owner = owner; rayMonitoring.orders.clear(); }
  rayMonitoring.orders.set(`${player}:${id}`, { ...state, updatedAt: Date.now() });
}
export function resetRayMonitoring(): void { rayMonitoring.owner = ""; rayMonitoring.orders.clear(); }

import {
  PM_MAINTENANCE_CHANNEL,
  subscribeChangmenChannel,
} from "@changmen/venue-browser/adapter/shared";
import { readonly, ref } from "vue";

/** PM 官网状态（server/realtime-hub/pm_maintenance.js 发布） */
export type PmOfficialState = "unknown" | "operational" | "maintenance" | "incident";

export interface PmMaintenancePayload {
  state?: PmOfficialState;
  pageStatus?: string;
  affected?: string[];
  checkedAt?: number;
  error?: string;
  source?: string;
}

const state = ref<PmOfficialState>("unknown");
const detail = ref<PmMaintenancePayload | null>(null);
let startPromise: Promise<() => void> | null = null;

function applyPayload(message: unknown) {
  const payload = (message ?? {}) as PmMaintenancePayload;
  const next = payload.state;
  state.value
    = next === "operational" || next === "maintenance" || next === "incident"
      ? next
      : "unknown";
  detail.value = payload;
}

/**
 * 启动 PM 官网维护状态订阅（幂等；未登录导致 hub 连不上时保持 unknown）。
 * 返回取消订阅函数。
 */
export function startPmMaintenanceFeed(): Promise<() => void> {
  if (!startPromise) {
    startPromise = subscribeChangmenChannel(PM_MAINTENANCE_CHANNEL, applyPayload);
    startPromise.catch((err) => {
      startPromise = null;
      throw err;
    });
  }
  return startPromise;
}

export function usePmMaintenance() {
  return { state: readonly(state), detail: readonly(detail) };
}

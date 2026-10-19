import type { DirectRealtimeStatus } from "@changmen/venue-browser/adapter/shared";
import {

  listDirectRealtimeStatuses,
  subscribeDirectRealtimeStatus,
} from "@changmen/venue-browser/adapter/shared";
import { onMounted, onUnmounted, ref } from "vue";

export function useDirectRealtimeStatus() {
  const statuses = ref<DirectRealtimeStatus[]>(listDirectRealtimeStatuses());
  let unsubscribe: (() => void) | null = null;

  onMounted(() => {
    unsubscribe = subscribeDirectRealtimeStatus(() => {
      statuses.value = listDirectRealtimeStatuses();
    });
  });

  onUnmounted(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  return { statuses };
}

import { onUnmounted, watch } from "vue";
import { useMatchStore } from "@/stores/matchStore";
import { useUserStore } from "@/stores/userStore";
import { useSignalSettings } from "./useSignalSettings";
import { startPmSignalMonitor } from "./runtime";
import { clearAllSignals } from "./state";

/** 每个登录用户只持有一个监测实例；实例内部响应涨跌设置，退出时统一清理。 */
export function useSignalMonitors() {
  const user = useUserStore();
  const matches = useMatchStore();
  const settings = useSignalSettings();
  let stop: (() => void) | undefined;
  watch(() => user.userId, (userId) => {
    stop?.();
    clearAllSignals();
    stop = userId ? startPmSignalMonitor(
      () => ({ down: settings.downSettings.value, up: settings.upSettings.value }),
      () => matches.matchs,
    ) : undefined;
  }, { immediate: true });
  onUnmounted(() => {
    stop?.();
    clearAllSignals();
  });
  return settings;
}

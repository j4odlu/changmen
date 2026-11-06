import {
  createDefaultPmOddsDropSettings, patchPmOddsDropSettings, createDefaultPmUpPrefs, normalizePmUpPrefs,
  type BrowserPmOddsDropSettings, type PmUpPrefs,
} from "@/config/pmSignalSettings";
import { toRef } from "vue";
import { useUserStore } from "@/stores/userStore";

/** 配置编辑与监测共用用户偏好；显示开关不参与检测。 */
export function useSignalSettings() {
  const user = useUserStore();
  const downSettings = toRef(() => user.extensionPrefs.pmDown ?? createDefaultPmOddsDropSettings());
  const upSettings = toRef(() => user.extensionPrefs.pmUp ?? createDefaultPmUpPrefs());
  function updateDownSettings(patch: Partial<BrowserPmOddsDropSettings>): void {
    user.extensionPrefs.pmDown = patchPmOddsDropSettings(downSettings.value, patch);
  }
  function updateUpSettings(patch: Partial<PmUpPrefs>): void {
    user.extensionPrefs.pmUp = normalizePmUpPrefs({ ...upSettings.value, ...patch });
  }
  return { downSettings, upSettings, updateDownSettings, updateUpSettings };
}

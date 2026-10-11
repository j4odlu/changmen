
/** [changmen 扩展] 下单出口独立于行情/查询路由，保存在当前浏览器。 */
export type PmOrderSubmitMode = "local" | "vps";
export const PM_ORDER_SUBMIT_MODE_KEY = "changmen:pm:order-submit-mode";

function storedMode(): PmOrderSubmitMode | null {
  try {
    const value = globalThis.localStorage?.getItem(PM_ORDER_SUBMIT_MODE_KEY);
    return value === "local" || value === "vps" ? value : null;
  }
  catch {
    return null;
  }
}

export function getPmOrderSubmitMode(): PmOrderSubmitMode {
  return storedMode() ?? "vps";
}

export function setPmOrderSubmitMode(mode: PmOrderSubmitMode): void {
  // 保存失败应让界面报错，不能显示一个没有生效的下单出口。
  if (!globalThis.localStorage) throw new Error("当前浏览器无法保存 PM 下单方式");
  globalThis.localStorage.setItem(PM_ORDER_SUBMIT_MODE_KEY, mode);
}

export function resolvePmOrderSubmitHttpMode(): "direct" | "vps" {
  return getPmOrderSubmitMode() === "local" ? "direct" : "vps";
}

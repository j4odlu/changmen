import { useMessageStore } from "./webBridge";

/** 采集器错误 → Telegram（对齐 Gi.send.CollectMessage） */
export function notifyCollectError(platform: string, detail: unknown) {
  try {
    const text = detail instanceof Error ? detail.message : String(detail);
    useMessageStore().collectMessage(platform, text);
  } catch {
    /* Pinia 未就绪时忽略 */
  }
}

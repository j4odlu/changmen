import type { BetOption } from "@changmen/client-core/models/betOption";
import { ensurePubsubConnected, pubsubPublish } from "@/realtime/pubsubClient";
import { useUserStore } from "@/stores/userStore";
import { captureBettingEventPayload, type BettingEventPayload } from "./bettingEventPayload";

/** [A8 可证实] bundle `z8e="Publish"` + `q8e` */
export const PUBLISH_CHANNEL = "Publish";

/** 下单成功且用户为 Publisher 时广播（对齐 A8 `q8e`） */
export async function publishBettingEvent(option: BetOption | BettingEventPayload): Promise<boolean> {
  const user = useUserStore();
  if (!user.setting?.Publisher)
    return false;
  const data = "provider" in option ? option : captureBettingEventPayload(option);
  if (!data)
    return false;

  const payload = {
    userId: user.userId ?? 0,
    action: "Betting",
    data,
  };

  await ensurePubsubConnected();
  return pubsubPublish(PUBLISH_CHANNEL, JSON.stringify(payload));
}

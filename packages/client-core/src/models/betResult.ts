import type { PlatformId } from "@changmen/api-contract";
import type { ObservationContext } from "@changmen/shared/order_observation";
import type { PlatformAccount } from "./platformAccount";
import { saveBetResultLog } from "../bridge/bettingLog";

/** 对齐 A8 bundle `uo` */
export class BetResult {
  provider: PlatformId;
  success: boolean;
  message: string | null | undefined;
  tip: unknown = null;
  reject: unknown = null;
  orderId: string | null = null;
  /** PM delayed / PF 挂单受理：已 API 成功但尚未最终成交 */
  pending = false;
  link = 0;
  /** [changmen 扩展] 管理端诊断执行阶段。 */
  diagnosticAttempt?: "initial" | "retry" | "makeup";
  /** [changmen 扩展] 旁路观察关联。 */
  observation?: ObservationContext;
  beginTime: number;
  request?: unknown;
  response?: unknown;

  constructor(
    provider: PlatformId,
    success: boolean,
    message?: string | null,
    request?: unknown,
    response?: unknown,
  ) {
    this.provider = provider;
    this.success = success;
    this.message = message;
    this.beginTime = Date.now();
    this.request = request;
    this.response = response;
  }

  /** [A8 可证实] bundle `uo.saveLog` */
  saveLog(account: PlatformAccount, beginTime?: number) {
    if (beginTime !== undefined)
      this.beginTime = beginTime;
    saveBetResultLog(this, account);
  }
}

export interface OrderBindRow {
  LinkID: number;
  Provider: PlatformId;
  OrderID: string;
  /** 可选；服务端 bind 也可用 Provider 匹配 */
  PlayerID?: number;
}

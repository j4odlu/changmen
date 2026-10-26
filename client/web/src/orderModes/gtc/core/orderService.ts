import type { GtcOrderPlan } from "@changmen/shared/pm_gtc_order";

export interface GtcOrderReceipt {
  success?: boolean;
  orderID?: string;
  status?: string;
  errorMsg?: string;
  pmSubmitNotSent?: boolean;
}
export interface PreparedGtcOrder extends GtcOrderPlan {
  validate: () => void;
  prepareSubmit: () => Promise<void>;
  submit: () => Promise<GtcOrderReceipt>;
}

/** [changmen 扩展] 存储、会话和观察由宿主接入；服务只控制一张 PM 原单的首次发送。 */
export interface GtcOrderPorts {
  assertSession: () => void;
  create: (plan: GtcOrderPlan) => Promise<string>;
  authorize: (id: string) => Promise<void>;
  acknowledge: (id: string, receipt: GtcOrderReceipt) => Promise<void>;
  recordUnknown: (id: string, message: string) => Promise<void>;
  close: (id: string) => Promise<void>;
  refresh: (id: string) => Promise<void>;
  onReceipt?: (receipt: GtcOrderReceipt, submittedAt: number) => void;
}

/** 授权须先持久化；未知回执仅记录并查询原单，不重试买入。close 不撤销剩余挂单。 */
export async function submitPreparedGtcOrder(prepared: PreparedGtcOrder, ports: GtcOrderPorts): Promise<string> {
  const { validate, prepareSubmit, submit, ...plan } = prepared;
  validate(); ports.assertSession();
  const id = await ports.create(plan);
  try {
    await prepareSubmit(); ports.assertSession();
    await ports.authorize(id); ports.assertSession();
    const submittedAt = Date.now();
    try {
      const receipt = await submit();
      await ports.acknowledge(id, receipt);
      try { ports.onReceipt?.(receipt, submittedAt); }
      catch { /* 日志或界面观察异常不能改写原单回执，也不能触发再次下单。 */ }
    }
    catch (error) {
      await ports.recordUnknown(id, error instanceof Error ? error.message : "提交结果待核实，请勿重复下单");
    }
  }
  finally {
    await ports.close(id);
  }
  await ports.refresh(id).catch(() => {});
  return id;
}

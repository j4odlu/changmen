/** [changmen 扩展] 动态 FOK 旁路消费者入口；订单簿核心独立位于 realtime/orderBook。 */
export { WsBookShadowRuntime, officialGateway } from "./submission/preflight/optimized/wsBook/bookRuntime";
export { WsBookShadowWorkerClient } from "./submission/preflight/optimized/wsBook/shadowWorkerClient";

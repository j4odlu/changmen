/** [changmen 扩展] 旧 GTC 对侧入口兼容；RAY 订单查询归 rayOrderMonitor。 */
export { pollGtcOther, startGtcCounterpartMonitoring as startRayGtcMonitoring, stopGtcCounterpartMonitoring as stopRayGtcMonitoring } from "@/runtime/gtcOrderMonitor/counterpart";

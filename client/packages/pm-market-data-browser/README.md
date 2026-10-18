# PM 浏览器公共订单簿

[changmen 扩展] 浏览器专属 workspace，`changmen.runtime=browser`。实现公共簿、被动 feed、FIFO、只读租约和通用 Worker 循环；没有 Vue、Pinia、账号、HTTP、签名器或下单依赖。`@polymarket/client/actions` 只作为开发时协议类型导入，SDK JavaScript 不进入核心构建。

`PmOrderBookService` 要求宿主显式注入 `BookHostPorts`：

```ts
const service = new PmOrderBookService({
  source, // observe(listener), subscribedAssets(); 没有订阅、发送或重连方法
  createWorker,
  allowed,
  monotonicNow: () => performance.now(),
});
```

`monotonicNow` 与宿主 `performance.timeOrigin` 使用同一时间坐标。端口只留在主线程；跨 Worker 仍只传递原有可序列化消息。宿主负责唯一服务实例、授权与 Worker 工厂，消费者只获得租约或诊断通道。构造函数没有默认平台源或默认 Worker。

| 入口 | 职责 |
| --- | --- |
| `src/bookReducer.ts`、`bookStore.ts` | 原有十进制归并、不可变历史和完整/展示读取 |
| `src/passiveBookFeed.ts`、`feedTypes.ts` | 接收已有行情帧，保留真实接收时间和失效范围 |
| `src/service.ts`、`orderedWorkerMailbox.ts` | 服务、租约、有界 FIFO、完整读的原 20ms 截止时间与最多 3 次重读 |
| `src/marketStreamProtocol.ts`、`serviceProtocol.ts` | 唯一行情源与服务消息协议 |
| `src/workerRuntime.ts` | 通用 Worker 消息循环，可注入公共簿诊断消费者 |
| `src/marketData.worker.ts` | 无诊断消费者、无 HTTP 的纯簿 Worker 入口 |

应用组合在 `client/web/src/runtime/pmMarketData.ts`。该宿主使用 adapter 的 `polymarket/orderBookSource` 只读端口和 web 自己的 Worker URL。带动态 HTTP 对照的 Worker 通过 adapter 兼容组合入口装配 `wsBook/workerDiagnostics.ts`；HTTP 对照、新鲜度、只读执行模拟及原观察插槽仍属于 adapter 浏览器消费者，不进入本包。卸载消费者保留同一个公共簿，迟到诊断回调不能跨 scope 投递。

adapter 旧核心路径只转导出本包，旧 service 构造签名通过薄适配器注入原 source，保留已有调用方；没有复制两份簿实现或建立第二条行情连接。Node 生产入口不得导入本包，Node 离线测试允许测试浏览器源码。

本地簿与旁路开关继续默认关闭，实际预检仍走 HTTP，经典 FOK 保持原样。本包迁入不授予独立发布资格，现有发布分类、完整来源指纹和原 551 项固定保护继续有效。实施与验证见 [B 批审计](../../../docs/audits/PM_BROWSER_MODULE_EXTRACTION_AUDIT_20261017.md)。

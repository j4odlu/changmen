# PM 本地订单簿：资产失效隔离与模块职责复审

> [changmen 扩展] 2026-10-17 后续已完成本版浏览器持续行情和真实后台/恢复验证：资产隔离受控检查通过，但出现 1 条独立对账差异和一个真实深度推进未满足项，当前生产旁路为 **NO-GO**。详见 [本版浏览器审计](./PM_BOOK_BROWSER_CONTINUITY_AUDIT_20261017.md)。以下“尚待浏览器验证”为本轮补验前的历史状态，不再作为当前结论。实际预检仍 HTTP、默认关闭、未发布。

[changmen 扩展] 2026-10-17。实施范围：既有 PM-M 被动旁路及其动态消费者；接续官方实践审计，先缩小失效范围，再整理职责和历史代码。**默认关闭、实际预检 HTTP、无真实本地预检启用、未发布。** 工作目录为 `E:\River\arb\changmen`，保留此前未提交改动，没有更换 FOK 基线或新增目录豁免。

## 当前结论

本轮资产隔离、消费者策略拆分和历史适配器清理已实施。相关行为回归、真实隔离 Worker 集成、FOK 固定模块及执行行为校验通过；没有发现本次改动介入经典 FOK 或替换动态实际 HTTP 返回值的路径。

结论是**代码层旁路整改通过，真实下单快路径仍 NO-GO**。没有生产发布或替用户开启。本轮未重跑真实浏览器持续行情、原生后台/恢复、总 CPU/堆 A/B 或 24h，不能将前轮 50.3125%/53.125% 的本地候选率作为本版指标，也不能宣称成交率提升。小范围生产旁路在另行授权发布前，应先补本版浏览器集成冒烟；只限此前明确选择直连动态复核的用户，并保留总开关回滚。此前的条件灰度结论不扩大为本版全面放行。

## 已实施的变更

| 审计问题 | 本轮处理 | 关键实现 |
| --- | --- | --- |
| 单资产 tick/坏帧/对账疑点清空所有簿 | 识别整个原始帧涉及资产，局部撤销；无法定位或连接/队列故障仍整体失效 | `passiveBookFeed.ts`、`bookStore.ts` |
| 局部变化推进全局代次，取消健康资产在途请求 | 分离全局与资产代次；资产移除再加入使用新代次，旧证明不能复活 | `bookStore.ts`、`service.ts` |
| 无关资产变化清空全部元数据/取消全部 probe | 资产 scope 和时间屏障，仅清除关联元数据/取消关联工作，其他资产保留原年龄 | `bookRuntime.ts` |
| 核心内混入动态预检年龄策略 | 核心保留原始行情状态，动态消费者统一用 `freshnessPolicy.ts` 检查原有年龄；`ready` 不是交易许可 | `bookStore.ts`、`freshnessPolicy.ts`、`executionSimulation.ts` |
| SDK 可选字段与本地严格假设混在一起 | 解析可选 hash，缺失时明确无执行证据；缺 timestamp 仍拒绝，不伪造新鲜度；side 按官方 schema 归一 | `bookReducer.ts`、`bookProtocolParity.test.ts` |
| 执行元数据依赖整个诊断报告 | 独立 metadata 消息携带连接代次/递增 revision/资产代次，报告不携带该数据 | `marketData.worker.ts`、`shadowWorkerProtocol.ts`、`shadowWorkerClient.ts` |
| 对账标签容易被当作同一交易所版本证明 | 增加 `comparisonEvidence=timestamp_and_observed_depth`；同毫秒歧义单列，差异局部撤销 | `bookRuntime.ts`、`shadowWorkerClient.ts` |
| 独立 WS 历史适配器保留在生产模块及导出 | 移到 `tests/helpers/directBookFeed.ts`，历史测试更新导入，生产入口不再导出 | `realtime/orderBook/index.ts`、历史测试 |
| 应用与动态挂载器重复线路轮询 | 由应用已有轮询调用消费者 reconcile；保留独立队列及在途诊断 watchdog | `pmMarketData.ts`、`pmDynamicWsShadowWorker.ts` |

表中 PM 文件短路径相对 `packages/venue-adapter/polymarket/`，应用文件位于 `client/web/src/runtime/`。没有修改本轮范围外的 PM-M 原订阅/重连、经典 FOK 算法、SDK 版本、后端、数据库或用户配置。

## 失效边界与竞态复审

1. A 的 tick、深度错误、缺 timestamp、可比对账疑点只使 A 等待快照；B 的簿、元数据时间和在途请求不因该事件撤销。如果该帧的增量同时涉及 A/B，整帧处理失败时同时撤销 A/B，绝不只保留半帧结果。
2. 无法定位资产的坏帧、源 epoch/线路变化、本地消息间隙、CPU 超限、消息超量/超龄仍全局失败关闭。缩小范围只针对能够完整识别的资产集合。
3. 局部恢复需要新的完整快照，增量不能恢复失效簿。资产代次单调变化；当前已撤销资产的旧不可变读结果、HTTP 结果和完整性提示不能重新生效。
4. 完整性提示必须携带当前代次、核心发出的历史对象。空/过期证明不能撤销恢复后的簿。probe 等待期间首次收到快照时，消费者在自身 scope 仍有效的前提下使用现有历史作为证明；发现可比差异仍撤销目标簿并清除刚得到的元数据，不能因启动时无快照而留下冲突参数。已补回归。
5. 元数据在模拟开始前冻结；本次 HTTP 不给自身本地候选补数据。metadata 的 revision、连接代次及资产代次分别阻止乱序消息、旧连接和旧资产状态复活。普通诊断 report 即使包含伪造旧字段，也不能作为元数据来源。
6. 原始流仍经过同一 FIFO，所有输入位置严格一致校验，最多 3 次追读共享原 20ms。没有跳过无关帧来提高命中率。
7. `aligned_equal` 只证明本地观察到的有限历史深度和时间戳相符；没有官方逐条连续序号，也没有验证 hash 的本地完整性算法。差异按资产保守处理，不声称已经证明 WS 丢包。

## 模块边界与兼容性

实际架构保持：**既有 PM-M → 独立订单簿服务/Worker → 动态旁路、只读深度等消费者**。网络控制仍归 PM-M；本地簿服务拥有 Worker、缓存、租约和停止；动态消费者拥有 HTTP 元数据、对账和业务年龄策略。

- 核心 esbuild 依赖检查只允许订单簿目录和 `marketStreamProtocol`，没有消费者或网络实现依赖。
- 真实生产 Worker 源码经 esbuild 后，在 Node `worker_threads` 隔离线程运行；WebSocket 构造器被设为抛错，测试仍通过。这验证生产 Worker 组合和隔离，**不是实际 Chrome 后台调度实验**。
- `readDepth` 保留最多 50 档展示视图，`readFullBook` 仍返回原资源上限内完整双边深度。结构性 `ready` 必须结合年龄/证据/元数据/读证明再判断，不能被展示消费者当成已通过交易规则。
- 经典/default/非法预检模式不启动簿服务；切经典/退出/关闭总开关释放旁路。动态消费者卸载只释放自身资源。原 signer 自动准备、双腿顺序、单次提交、确认、补单和绑定规则保持原有语义。
- `runOptimizedFokPreflight` 的实际预检仍调用原 `tasks.market()`，成功对象和失败异常沿原路径；没有等待旁路结果或返回旁路报价的执行连线。两个开关均不能授权真实本地快路径。

## 阈值没有放宽

| 检查 | 保持的限制 |
| --- | --- |
| 动态接收年龄 / 完整快照年龄 | 1,000ms / 60,000ms |
| 动态 HTTP 参数年龄 | 60,000ms，保留原获取时间 |
| 源时间落后 / 超前 | 5,000ms / 1,000ms |
| 完整读+计算 / 追加重读 | 原 20ms / 最多 3 次，不延期 |
| 核心容量 | 16 资产、每侧 2,000 档、4 份历史、1,000,000 字符/帧、128 候选事件 |
| FIFO 合计 / 在途批次 | 2,048 条、2,000,000 字符、1,000ms / 8 批 |
| 批次 / 主线程让出 / Worker 工作预算 | 64 条、目标 256,000 字符 / 2ms / 每 100ms 的 20ms |
| probe / 并发读 | 3 秒一次、单 probe 在途、5 秒超时 / 合计 32 个读请求 |

过期簿保留用于行情展示与诊断，原快照时间不被增量刷新；动态消费者仍拒绝过期簿。无 hash 的快照可解析，但不能生成本地执行候选。以上策略为 changmen 的保守门槛，不是 PM 官方强制数值。

## 回归记录

- 定向回归最终 **21 文件、274 项通过**：订单簿、消息队列、真实 Worker、元数据、执行模拟、主线程消费者、应用生命周期。
- 最终代码全量前端回归 **510 文件、4,518 项通过，3 文件/3 项跳过**，含首次快照/probe 边界补丁；最终耗时 169.33 秒。首次 `--maxWorkers=4` 有 3 项超时，分别涉及既有订单监控、凭据导出兼容和 vault 解锁；3 文件/100 项单独复跑通过，降低并发到 2 后全量通过。没有调大超时或跳过失败项。
- `npm run typecheck:frontend` 通过。最终生产构建（含 vue-tsc）亦通过，详见下方构建记录。
- `node scripts/verification/verify-fok-execution-parity.mjs` 通过：180 组比较、20 组成交确认故障、45 组原门控、49 个函数保真。报告保留原有历史差异，不修改既有基线。
- `npm run check:fok-vps` 通过：551/551 固定受保护模块，`fullReleaseAccepted=false`；这不是发布审批。
- 原共享流、旁路及 FOK 防篡改 **6 文件/58 项通过**；执行输入和配置入口的 Node 测试 **8 项通过**。
- `npm run check:boundaries`、`npm run check:venue-adapter` 通过；冻结路径零命中；`git diff --check` 通过（存在仓库已有换行风格提示）。

复现命令：

```text
# 仓库根
npm run typecheck:frontend
npm run app:build
node scripts/verification/verify-fok-execution-parity.mjs
npm run check:fok-vps
npm run check:boundaries
npm run check:venue-adapter
node --test scripts/verification/pm-execution-shadow-boundary.test.mjs scripts/verification/pm-book-settings-boundary.test.mjs
npx vitest run scripts/verification/pm-ws-shadow-boundary.test.mjs scripts/verification/pm-shared-stream-boundary.test.mjs scripts/verification/pm-fast-fok-boundary.test.mjs scripts/verification/pm-legacy-fok-runtime-boundary.test.mjs scripts/verification/pm-optimized-fok-boundary.test.mjs scripts/verification/pm-unified-preflight-boundary.test.mjs --maxWorkers=2

# client/web
npx vitest run --maxWorkers=2
```

构建记录：`npm run app:build` 成功（含最终 vue-tsc），保留已有静动态导入及大 chunk 警告，未修改构建阈值。Worker 为 `marketData.worker-Dhj0aiZm.js`，23,920 字节；SHA-256 `1bc49e56e265b37b8ccfc1c36044b4a48dfb373b490f9a834eec1df588d4cdf0`。这是本机构建，未上传或发布。

## 官方能力复用与剩余条件

本地安装的 `@polymarket/client` 为 0.12.0，本轮未升级。生产仅使用公开 `@polymarket/client/actions` 的 `StandardMarketEvent` 类型；7 项协议对照测试使用已安装 SDK 内部 schema 校验可选 hash、side 归一和缺时间策略。内部 schema 仅是测试 oracle，不在生产中依赖其不稳定接口。

官方实践建议维护本地簿，但不要求为预检另建连接。官方 WS SDK 包含连接/事件分发管理，不能直接作为注入现有 PM-M 原始流的完整本地簿服务使用；替换其传输会超出“不改订阅重连”的授权范围，因此保留中性的 reducer、被动 feed、Worker 和读租约。

参考：[Market Making](https://docs.polymarket.com/trading/market-making)、[Real-Time Data](https://docs.polymarket.com/market-data/realtime-data)、[SDK Market WebSocket 源码](https://github.com/Polymarket/ts-sdk/blob/main/packages/client/src/websockets/clob/market.ts)、[SDK 协议 schema](https://github.com/Polymarket/ts-sdk/blob/main/packages/bindings/src/subscriptions/clob.ts)、[内部 bindings 边界](https://github.com/Polymarket/ts-sdk/blob/main/packages/bindings/README.md)。

继续旁路验证应固定源资产与机会分母，保留缺快照、参数未知、处理位置追不上、业务拒绝等全部样本；分别测目标/无关资产失效率、健康资产误失效数、元数据与簿年龄、队列/CPU/堆、原行情时延和经典隔离。全新构建仍需真实浏览器持续与后台验证。出现可比计算差异、旁路持续失效、原行情明显变慢或经典异常，关闭本地订单簿总开关；只关闭动态对照则保留公共簿。没有自动新增 WS 或 HTTP 补簿路径，也没有真实下单快路径回滚开关。

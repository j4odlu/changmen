# PM 本地完整订单簿模块

[changmen 扩展] 复用现有 PM-M 原始流，由独立服务维护公共簿；动态预检作为旁路消费者，深度展示接口已预留、尚未接 UI。**默认关闭，实际预检仍 HTTP，没有真实下单快路径，未发布。** 当前实现及验收见 [资产隔离复审](../../../../../docs/audits/PM_BOOK_ASSET_ISOLATION_REAUDIT_20261017.md)。

## 职责与依赖

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 原连接 | `../ws.ts`、`../marketStream.ts` | PM-M 独占订阅、心跳、重连；已有观察钩子广播原始帧，本轮未改 |
| 服务 | `service.ts`、`serviceProtocol.ts` | 源观察、单 Worker、有界 FIFO、资产准入、读租约和释放 |
| 核心 | `passiveBookFeed.ts`、`bookReducer.ts`、`bookStore.ts` | 协议归并、完整快照/增量、资产失效、不可变历史、双边深度投影 |
| 组合入口 | `../../marketData.worker.ts` | 装配簿与可选动态消费者，传递读请求和独立元数据消息 |
| 动态消费者 | `../../submission/preflight/optimized/wsBook/` | HTTP 元数据、对账、业务新鲜度、等价计算和旁路回退模拟 |
| 应用授权 | `client/web/src/runtime/pmMarketData.ts`（仓库根相对路径） | 登录/模式/线路/总开关授权与服务生命周期 |

核心不导入预检、账号、HTTP、签名、订单或行情 Hub；被动 feed 没有 WebSocket/fetch/订阅/重连权限。服务只读既有 esport 源资产，不能扩大订阅。动态消费者卸载不清空公共簿、不终止服务；只开总开关无动态候选 watcher 或 HTTP probe。

历史独立连接适配器已移到 `../../tests/helpers/directBookFeed.ts`，取消生产导出；仅历史测试使用，没有自动切换独立 WS 的运行路径。旧 `shadow.worker.ts` 亦不作为运行入口。公开 SDK 事件类型仅类型导入，编译后消除；SDK 内部 schema 仅用作测试对照，不进入生产包。

## 快照、增量和资产失效

- 只有完整 `book` 建立本地簿；晚接入或移除后重新加入须等待下一份完整快照。快照前增量不能恢复簿，HTTP probe 不注入 WS 深度。
- `price_change` 以价格为键覆盖数量，数量 0 删除；BUY/SELL 大小写按官方 schema 归一。同一原始帧原子处理，不保留错误帧的部分更新。
- tick、可定位资产的坏深度/缺失时间和可对照的完整性疑点，只撤销受影响资产。若一帧触及多个资产而原子处理失败，撤销全部涉及资产，保留其他资产。
- JSON/身份无法辨认、连接/来源变更、本地消息间隙、队列年龄或 CPU/共享资源失效仍撤销整体旁路证据。单资产档位超限仍严格拒绝该帧，并撤销该帧涉及的资产。不能证明局部范围时，不猜测范围。
- 资产移除/失效不再推进全局簿代次；`assetGeneration` 单独识别该资产恢复前后。服务读证明也有资产撤销代次，移除再加入不能复活旧结果。断线仍推进全局代次。
- 服务取消相关资产读请求，消费者只清除相关元数据、取消相关 probe/HTTP 复用；其他资产原始时间和在途工作保持不变。

服务在原 PM-M 已登记集合内最多维护 16 个资产；已接纳消费者优先，再保留有界预留集合。无关资产帧仍完整经过同一 FIFO 并纳入输入位置；合法的无关深度在解析后按资产筛选。BBO、成交、PONG、空数组和读请求不能刷新深度时间。

`hash` 在官方 schema 中允许缺失：可解析的无 hash 快照保留为行情状态，但 `snapshotEvidence=false`，动态模拟必须回退；后续增量不能把该标志补成真。非空 hash 也不是本地已验签或完整性校验成功的证明。没有 timestamp 则拒绝该资产的帧，不用客户端时钟冒充源时间。

## 读取契约和新鲜度

`acquirePmDepthView()` 仅对已有授权会话返回租约，不会自行启用服务。租约支持 `setInterests/readDepth/readFullBook/isCurrent/onChange/release`，没有订阅、重连或停止服务权限。

`readDepth` 默认 20 档、最多 50 档，返回排序后的十进制字符串和 `viewTruncated`。`readFullBook` 返回核心限制内完整双边深度，保留源时间、单调接收/快照时间、session/epoch/generation/assetGeneration/revision 及已处理输入位置。副本冻结，不能伪造或复用已撤销的证明。

**`status=ready` 仅表示结构上存在簿，不代表可用于交易。** 核心不再因动态消费者的 60 秒策略删除簿，展示读取保留原年龄。动态消费者通过 `freshnessPolicy.ts` 检查接收年龄 ≤1 秒、完整快照年龄 ≤60 秒、元数据年龄 ≤60 秒、源时间落后 ≤5 秒/超前 ≤1 秒。负接收/快照/元数据年龄也拒绝。增量不刷新 `snapshotAt`，过期簿仍回退，绝不因保留状态而提高预检通过率。

完整读仍共用原 20ms 截止时间，最多追加 3 次 FIFO 重读；最终 `isCurrent` 必须覆盖当前**全部**输入位置。追不上、超时、断线、失效、释放、元数据代次不匹配均只产生旁路回退原因。该输入位置是本地序号，不是交易所连续序号。

## 元数据和对账

动态消费者拥有 HTTP 参数及其原始获取时间，跨线程经带 generation/revision 的独立 `metadata` 消息传递；诊断 `report` 不再携带可执行元数据，也不能作为其来源。过期报告、旧 revision、旧资产代次不能恢复参数。所有元数据须在本次模拟开始前冻结，本次 HTTP 不能为自身本地候选补证据。

`aligned_equal/aligned_difference` 只表示有限历史中时间戳及已观察深度的比较，样本明确标记 `comparisonEvidence=timestamp_and_observed_depth`。同毫秒可能有多次变化；有歧义即单列。差异按资产保守撤销，不能据此宣称已证明服务器丢帧。完整性提示须有核心发出的同资产、同代次历史证明，空证明/旧证明不可撤销恢复后的簿。

## 资源限制

- 核心：16 资产、每侧 2,000 档、单帧 1,000,000 字符、筛选后 128 个事件、每资产 4 份历史。
- 消息队列：待发和在途共 2,048 条/2,000,000 字符/1 秒年龄；最多 8 批在途、每批最多 64 条，目标 256,000 字符，单条大消息独占一批。MessageChannel 唤醒，累计复制 2ms 后让出主线程。
- Worker 解析/归并预算：每 100ms 窗口 20ms。超限使本地证据失效并跳过该窗口余帧，下一窗口仍需完整快照。同步工作不可抢占，这是事后预算检查，不是硬 CPU 限制。
- 每服务最多 4 租约、32 个在途读请求，每租约最多 4 个监听。常规更新通知最多 10Hz，失效及时通知，无监听无通知轮询；普通深度读取保留原 5 秒超时检查。

本轮没有扩大以上额度。源断开、故障或总开关关闭只释放本地资源，不更改 PM-M。服务故障不无限重启；恢复须新授权会话。后台冻结与长任务仍可能超过年龄门槛，不能忽略或重新打时间。

## 开关、验证与限制

应用仍要求显式 optimized、登录 ready、官方 PM-M、HTTP/提交直连及合格账号。`changmen:pm:local-book=1` 是本地总开关，`changmen:pm:ws-book-shadow=1` 挂载动态消费者，均默认缺失关闭。经典/default/非法模式不启用服务。关闭 shadow 仅停消费者，关闭总开关/切经典/退出会释放服务。

本轮合并了应用与动态挂载器重复的线路轮询；保留服务队列 watchdog 和消费者在途诊断 watchdog，两者职责不同。未改变原 HTTP 预检或实际下单入口。`coverage`、本地候选数、对账一致数均不等于成交率。

官方实践见 [Market Making](https://docs.polymarket.com/trading/market-making) 和 [Real-Time Data](https://docs.polymarket.com/market-data/realtime-data)。独立模块不需要独立连接；现有官方 WS SDK 的连接管理不能直接取代该被动源且保持 PM-M 控制权。未升级 SDK。

历史浏览器证据见 [可用率复审](../../../../../docs/audits/PM_BOOK_AVAILABILITY_REAUDIT_20261017.md)。本轮修改了 Worker，旧构建的覆盖率、后台和性能数据不自动成为本版验收。当前回归、生产旁路边界与剩余验证见 [本轮复审](../../../../../docs/audits/PM_BOOK_ASSET_ISOLATION_REAUDIT_20261017.md)。

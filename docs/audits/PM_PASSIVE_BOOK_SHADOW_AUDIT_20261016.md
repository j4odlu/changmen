# PM-M 被动订单簿旁路：实施与复审

[changmen 扩展] 2026-10-16；工作目录 `E:\River\arb\changmen`；基点 `2bdf3773f5270d96a807d5d077bcd42f6724b1ee` 加当前未提交改动。

当前实现替代上一版生产入口的独立深度连接。用户要求不发布；本轮没有提交、推送、部署、修改用户开关或提交订单。默认 off，实际预检始终 HTTP，没有 active 快路径。

## 1. 依赖和所有权

```text
原 PM-M realtime/ws.ts（唯一连接拥有者）
  ├─ 原 tick / quote / fo 链路，原顺序保留
  └─ realtime/marketStream.ts：只读原始帧和实际连接生命周期
        → 动态消费者的有界 Worker 消息桥
        → realtime/orderBook/PassiveBookFeed + bookReducer
        → optimized/wsBook/bookRuntime：HTTP 对账、元数据、诊断
```

- `marketStream.ts` 没有 socket、timer、订阅发送能力，不缓存原始帧；最多四个观察者，异常隔离并移除失败观察者。无观察者时不构造逐帧事件或获取旁路时间戳。
- `marketStreamProtocol.ts` 是无运行副作用的公共行情类型。订单簿核心只依赖本目录及该类型，不引用预检、Pinia、账号、签名器、订单或 `fo`。
- `PassiveBookFeed` 默认由动态消费者实例化，但核心不依赖该消费者；另一业务可通过独立生命周期消费核心。Worker 入口是本轮消费者的组合层，不是核心反向依赖。
- `DirectBookFeed` 保留为独立适配器和历史回归参照。生产 Worker 的依赖图不包含它；禁止自动回退到独立 WS。
- `marketQuoteHub.ts`、订阅函数、原心跳/重连/自动换线算法未修改。不能调用第二次 `startPolymarketMarketWs`，不能注册额外行情订阅消费者。

## 2. 采信范围与时序

候选仍来自原有前端有界选择。首版维护 `候选前 16 个 token ∩ PM-M esport 已登记订阅 ∩ 实际已打开的 official 连接`；不扩大原订阅，不为缺失资产补开连接，不接入独立体育行情总线。登记集合只表示已有订阅意图，必须实际收到完整 `book` 才建立该资产深度。

PM-M 入口记录单调接收时间和 wall time；原报价处理完成后转发同一原始字符串。不能从最优价或 `fo` 反推深度。Worker 使用主线程接收时间而非出队时间计算新鲜度，跨线程通过 `performance.timeOrigin + performance.now()` 换算。

| 事件 | 处理 |
| --- | --- |
| 开始观察已有连接 | 仅取得连接状态，绝不重放旧帧；等待新完整快照 |
| 快照前增量 | 丢弃，不缓存后叠加到 HTTP 快照 |
| `book` | 完整替换所关注资产的买卖深度 |
| `price_change` | 数量覆盖，0 删档；相同时间戳依接收顺序应用 |
| 不相关资产 book/tick | Worker 内按明确 asset_id 过滤；不影响候选簿 |
| 候选增删 | 删除资产证据；保留健康资产；新增/重新加入者等待快照 |
| 断线/停止/换线 | 清空旧代次证据；旧 socket 回调及旧代次消息不能复活簿 |
| 重连 | 跟随原重连流程，等新连接完整快照；不续接旧深度 |
| tick、坏帧、缺帧、乱序、本地处理预算超限 | 只作废本地簿，等待下一完整快照 |
| HTTP 可对齐差异 | 只清空本地代次，不调用 PM-M stop/reconnect/send |
| 60 秒快照期限到达 | 读取判定 stale；下一帧处理时移除过期资产；不定期重连，不请求额外快照 |

本地消息序号只用于发现本地桥接缺帧，不是交易所序号，不能证明交易所端没有漏事件。HTTP 不为 WS 建簿；时间戳相同也可能存在不同状态，仍单独统计 ambiguous，不能计入一致。

## 3. 资源及故障隔离

- 默认关闭；只有已生效 optimized、显式浏览器开关、登录有效及原直连条件满足才启动。经典/非法/缺省模式不启动 Worker、深度 watcher、probe、帧队列；共享入口仅增加轻量调用，不能描述成零 CPU 成本。
- Worker 桥最多 8 条未确认 stream 消息、合计 2,000,000 字符；单帧 1,000,000 字符。包括连接状态在内使用同一 FIFO。字符数不是网络字节数；UTF-16 字符串的实际占用还包括复制及运行时开销。
- 队列超限或单帧超限立即终止旁路 Worker、解除观察；确认超过 1 秒由旁路原有 1 秒 reconcile 检测，后台节流可能更晚。Worker 出队也检查 1 秒接收年龄。故障后不自动重建旁路来形成重试循环；需关闭再开启旁路或重新建立用户 scope。
- 完整簿仍限 16 资产、每侧 2,000 档、每帧 128 事件、每秒 500 帧；超限不截断成“完整簿”。20ms 处理检查是事后丢弃门槛，不是硬 CPU 上限。
- HTTP probe 保持最快 3 秒一次、并发 1、5 秒超时、有界响应，只对当前覆盖候选执行；它不替代真实 HTTP 预检，故本轮不声称减少实际预检 HTTP 次数。
- 32 个比较上下文、10 秒超时、256 条近期实际 HTTP 完成和最多 32 条 probe 摘要。HTTP 结果、耗时和身份仍由主线程原钩子记录。代次变化后完成的 HTTP 会取消旧 Worker 上下文，避免占满其容量。
- 退出、切回经典、账号变更只清理本消费者；不停止原 PM-M、不注销原行情消费者。Worker 错误或观察者异常不能成为交易错误。
- 高频 frame/ACK 不反复读取 localStorage 或扫描账号。没有同标签页事件的 HTTP/提交线路偏好由原旁路 1 秒 reconcile 复查，状态事件、HTTP 尝试和报告回调也校验；后台节流可能延长该窗口。模式/用户/账号清理由拥有者同步执行。该窗口只影响公共诊断流，实际预检不依赖旁路。

## 4. 本轮复审中修复的事项

1. 生产消费者原来默认构造 `DirectBookFeed`：改为独立的 `PassiveBookFeed`，真实 Worker 打包依赖图检查没有独立 socket 适配器。
2. 对账差异原来通过 stop/setAssets 重连：统一改为 feed 的本地 reset；被动适配器没有网络权限。
3. PM-M 比候选范围更大：加入 Worker 内快照/tick 资产过滤，避免其他资产快照使候选整组失效。
4. 共享消息可能积压或旧报告迟到：加入消息/字符上限、ACK 期限、接收年龄、连接 epoch、局部序号和报告 generation；旧报告不能覆盖当前 scope。
5. HTTP 在代次变化后完成可能遗留 Worker 比较上下文：完成失效样本时明确发送 cancel，新增行为回归。
6. 已终止 Worker 的排队回调可能重新填入旧报告：接收端先检查当前 Worker 存活，超限/超时测试模拟迟到报告并验证不能复活。
7. 删除候选后其他通用消费者可能仍持有旧的已发布集合：移除时立即发布裁剪后的不可变视图；原保留资产的 revision 不变。

## 5. 验证记录

- `npm run test:frontend`：501 文件通过、3 文件条件跳过；4,409 测试通过、3 条跳过，包含前端类型检查。日志：`output/pm-passive-frontend-regression.log`。
- 新增被动核心、共享连接、真实隔离 Worker 集成：23 条通过。覆盖快照/增量、晚接入、候选变化、无关资产、源切换、旧回调、超限、积压、60 秒有效期、70 秒不新增连接、HTTP 代次失效取消。
- 两组精确增量边界测试：16 条通过，包含篡改、重复钩子及修改原重连常量拒绝。
- `node scripts/verification/verify-fok-execution-parity.mjs`：180 项对照、20 项确认故障、45 项原门控通过。
- `npm run check:fok-vps`：固定 551 项原始 manifest 全部保护通过；未修改原始 manifest、旧增量或固定哈希。
- `npm run check:boundaries`、`npm run check:venue-adapter` 通过。
- 最终定向回归（被动流、Worker、原旁路、动态控制器、动态预检、PM-M 与行情 Hub）：128 条通过，1 条显式联网参照测试跳过。
- `npm run app:build` 通过（包括 vue-tsc 和 Vite）；存在既有大 chunk 提示，无构建错误。日志：`output/pm-passive-build.log`。
- `git diff --check` 通过。未运行显式联网的历史独立连接测试，未把跳过项描述为生产链路验证。

新增 `pm-shared-stream-increments.json` 只登记 `realtime/ws.ts` 的具体只读钩子，先精确还原，再对实施前整文件哈希及已有固定基线核验。不按路径豁免，也不修改固定基线。

## 6. 当前结论与限制

代码与本地回归支持继续保留默认关闭的被动旁路。**最新结论仍为 NO-GO，原因已更新。** [修复前浏览器审计](./PM_PASSIVE_BOOK_BROWSER_AUDIT_20261016.md) 的 8 条逐帧队列与 500 帧/秒共享流限制已修复；[批量队列复审](./PM_PASSIVE_BOOK_BATCH_REAUDIT_20261016.md) 完成 30 分钟真实流、1,806,900 帧，冷/晚接入 Worker 均存活，报价一致性和经典/HTTP 保真通过。但尚未取得真实 hidden 后台调度样本，固定候选结束时 10/16 为 HTTP 404，需要当前有效候选覆盖验证。不能把历史溢出继续描述为现有前台故障，也不能把修复前的 0/1,440 作为本版覆盖结果。

本轮不发布，不继承上一版独立连接的生产旁路放行结论。旧独立连接的浏览器 JSON 仅作历史证据，不作为本版已实测依据。

已经验证的是不新增旁路 WS、不新增订阅/重连动作及故障隔离。不能宣称总体流量降低固定比例、HTTP 预检提速或双腿成交率提升；实际预检仍 HTTP。本版允许长期报告 `no_snapshot`/`stale_book`，不能为提高命中率放松门槛或主动重启 PM-M。

## 7. 本机开关与观测

默认没有开关值。仅获准本机取证时，已保存动态复核并满足直连条件的浏览器可设置 `localStorage.setItem("changmen:pm:ws-book-shadow", "1")` 后刷新；移除该 key 后刷新关闭。此文不授权发布或替用户打开开关。

`window.pmWsBookShadowReport?.()` 应显示 `feed: "passive-pm-m"`、`executionSource: "existing-http"`、`activeSupported: false`。重点检查 requestedAssets/assets/uncoveredAssets、streamOpen/streamEpoch、pendingStream/pendingStreamChars、failure、stream_frames/stream_chars、workerCounters 及各类 miss/对账结果。

发现新增 WS、额外订阅/重连、经典行为变化、明显主线程卡顿，立即关闭旁路并保留报告。队列超限/Worker 故障已经自动停旁路；低覆盖率不触发网络恢复。未来若讨论生产小范围验证，须另外验证浏览器性能及覆盖率并取得发布授权。

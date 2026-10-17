# PM WS 订单簿旁路：五项修复与重新审计

> 历史独立连接版本报告。后续用户已要求复用 PM-M 被动流且不发布；当前实现、验证和限制见 [被动旁路复审](./PM_PASSIVE_BOOK_SHADOW_AUDIT_20261016.md)。本文生产放行结论及浏览器证据不自动覆盖后续共享流版本。

[changmen 扩展] 2026-10-16，`E:\River\arb\changmen`，master 基点 `2bdf3773f5270d96a807d5d077bcd42f6724b1ee` 加当前工作区改动。此前发现保留在 [首次审计](./PM_WS_BOOK_SHADOW_AUDIT_20261016.md)，不以删除历史复现或更换固定基线代替修复。

**结论：五项问题已修复，允许直连、显式选择动态复核的少量生产用户开启 shadow 旁路观察。默认继续关闭；不批准默认全量启用，也不批准真实下单快路径。实际预检和下单仍使用原 HTTP 结果。本轮没有部署、没有修改真实用户开关、没有使用账号签名或提交订单。**

## 1. 逐项修复证据

| 问题 | 修复 | 回归与重新审计 |
| --- | --- | --- |
| A1：同步大帧阻塞主线程 | reducer 每帧每资产每方向最多复制一次；浏览器生产入口使用独立 Web Worker，WS 解析、完整簿、HTTP probe、比较和深度计算全部在 Worker 内。主线程只复制最多 2,000 档的数值摘要，不等待比较结果 | 正式回归检查 2,000 条增量仅遍历一次旧侧；真实浏览器多资产压力见第 3 节。20ms 仍是 Worker 的事后丢弃门槛，文档不再把它当硬 CPU 预算 |
| A2：短暂切换线路后不恢复 | core/runtime 对相同候选也能恢复已停止的 feed；前端 reconcile 核对 Worker 客户端是否已停止，必要时重新创建并重新提交候选 | core 的 false→true 快切、相同候选恢复、旧回调不能复活；前端同候选 runtime 替换；新旧用户 scope 不串联 |
| A3：单 token 无快照拖垮整组 | 8 秒后按资产通知 `unavailable`，健康簿保持运行。缺失资产每代只标记一次，等待迟到完整快照或下一次 60 秒周期重建，不增加高频重试。官方空初始事件列表 `[]` 视为无证据，不刷新簿龄、不按坏帧重连 | 15 健康 + 1 缺失运行 60 秒：健康连接不断、继续消费增量、缺失通知一次；周期后可恢复缺失 token。无快照始终 miss，不以 HTTP 填充 WS；空列表前后只读容器及历史状态均受保护 |
| A4：消费者修改内部簿 | 所有 book 字段只读且对象冻结；内外 Map 容器通过无写方法的视图发布，`forEach` 第三个参数也是只读视图，底层 Map 不逃逸。按帧复制保留旧 revision | 两个消费者共享读视图：属性替换失败、原生 `Map.set.call` 失败、`forEach` 无写入口；后续增量不改变旧版本 |
| A5：统计漏掉坏样本 | 主线程对每个已准入 HTTP 尝试保留一次完成记录，包括断线、路由失效、容量超限、Worker 失败、观察超时和 scope 停止。Worker 仅补充比较证据，不覆盖真实 HTTP 标识、结果和时间 | 40 并发中只有 32 个持有比较引用，但 40 个 HTTP 完成都保留；重复 finish 不重复计数；跨 epoch、退出后的完成、256 样本淘汰及总计数均覆盖 |

核心文件：`packages/venue-adapter/polymarket/realtime/orderBook/{bookReducer,directBookFeed}.ts`。动态消费者及 Worker 位于 `submission/preflight/optimized/wsBook/`，前端生命周期在 `client/web/src/runtime/pmDynamicWs{Preflight,ShadowWorker}.ts`。

## 2. 四项业务边界复审

1. **经典 FOK 保持原语义。** 本次修复没有继续修改原交易接入钩子。原 `fok/`、`legacy/`、`pmBuyPreflight.ts`、价格/金额/深度计算、签名准备、双腿编排、确认和补单规则无新增变更。首次实施的三个接入点继续逐字还原核验，551 个固定 manifest 条目不变。legacy/default/非法模式不创建 Worker、深度 watcher、旁路 WS 或 HTTP probe。公共模块仍有轻量模式监听和代码打包成本，不表述成“零字节、零指令”。
2. **行情模块独立。** `realtime/orderBook/` 只依赖本目录；没有预检、账号、签名器、HTTP 下单、Pinia 或全局 `fo` 依赖，也没有导入即启动的单例。Worker 属于消费者的运行方式，不把行情核心反向绑定到预检。
3. **动态预检是消费者，当前只做旁路消费。** optimized hook 在原 `tasks.market()` 前后触发诊断，HTTP 调用、原返回值和异常不变。Worker 的结果只更新报告，不能改变通过/拒绝、下单价格、金额或深度。没有 active 状态和真实执行簿 getter。
4. **新增失败不会触发真实交易降级或阻断。** Worker 加载/CSP/消息/运行失败，旁路 fail closed；真实预检继续原 HTTP。不把重处理回退到主线程，不切换代理，不产生订单请求。关闭、账号变更、退出清除当前 UI 入口并终止 Worker；旧在途 HTTP 只完成旧对象的私有统计，不附加到新用户。

## 3. 验证结果

| 检查 | 结果 |
| --- | --- |
| 最终定向行为回归（旁路、前端生命周期、动态、legacy runtime、FOK bet） | 7 文件、381 项通过 |
| 全量前端 Vitest，`--maxWorkers=4` | 498 文件、4,386 项通过；3 项显式联网测试按条件跳过。保留全部旧测试及原超时，不放宽断言 |
| `npm run app:build` | 通过，包含 `vue-tsc -b` 和 Vite；Worker 入口也纳入 TS 检查，单独产出 `shadow.worker-Bi5hPK0h.js`。原有大 chunk 提示仍存在 |
| `npm run check:boundaries`、`npm run check:venue-adapter` | 通过；没有触碰冻结路径 |
| 精确增量及反篡改回归 | 16 项通过 |
| `node scripts/verification/verify-fok-execution-parity.mjs` | 180 组对照、20 个确认故障、45 个原门控场景通过 |
| `npm run check:fok-vps` | 551/551 固定 manifest 条目通过，原行为、共享边界、GTC 隔离检查通过 |

浏览器使用隔离的公开验证页，不加载登录账号或交易应用。生产 Worker 通过与应用相同的 Vite 构建产物启动；本机 origin 为 `http://127.0.0.1:5419`。这验证了真实 Chromium Worker、WS、fetch/CORS 和消息通路，不等于生产站点 CSP、所有设备和用户线路已全部验收。

- **公开官方连接：** 最终构建在 Lula 总统选举活跃 token 上运行 89.01 秒，记录 3 个完整快照、62 次资产增量更新、1 次周期重建；比较计数含 22 次对齐一致、4 次同毫秒歧义、2 次无法对齐、1 次重建期无快照，可对齐差异为 0，未观测到主线程长任务。一次公开 HTTP 合成观察耗时约 258.3ms，结果为 `unaligned_or_changed`，完整保留了时长及标识。原始证据见 [浏览器官方直连报告](./pm-ws-book-shadow-browser-live-20261016.json)。`public-harness` 不是实际下注，也不是双腿成交率样本。先前的网球市场在复测中结束，官方 `/book` 404、WS `[]`，这促成了 A3 空列表回归；没有把该失败当成成功。
- **多资产持续压力：** 最终 Worker，16 个资产，每资产 2,000 档、每 100ms 产生 2,000 条增量。54.83 秒记录 16 个完整快照、8,624 次资产增量更新；32 个合成观察全部完成，最终比较队列为 0，无处理预算重建。主线程没有观测到 ≥50ms 长任务，16ms 心跳额外延迟 P95 约 0.8ms、最大约 1.5ms；32 次 finish 回调最大约 0.4ms。Worker 完成队列 P95 约 12.0ms、比较 P95 约 0.3ms，已与 HTTP 耗时拆开。详见 [压力报告](./pm-ws-book-shadow-browser-stress-20261016.json)。首轮夹具丢启动消息的无效测试未作为通过证据。
- **复制成本：** 同类 2,000 档/2,000 条合成增量在本次 Chromium 的五次 reducer 测量为 1.3–2.2ms；旧审计 129–140ms 来自 Node，两者运行环境不同，不据此宣称固定提速倍数。正式回归直接验证复制次数，浏览器压力验证隔离效果。

日志位于 `output/pm-ws-fix-*.log`，浏览器夹具和 CLI 记录位于 `output/playwright/pm-shadow-*`。完整测试命令沿用计划第 12 节及上述命令。未运行真实套利双腿 A/B，也未验证更高成交率；旁路没有改变预检数据源，本阶段不能声称实际预检或成交率已提升。

## 4. 报告分母和生命周期约定

- `counters.attempt_seen` / `attempt_completed` / `http_resolved` / `http_rejected` 是**当前客户端 scope 的总计数**，不受 Worker 比较成功率和最近样本淘汰影响。`pendingHttp = seen - completed`；在途未完成不能伪报成失败。
- 最近 256 条 attempt 用于 `httpMarketMs`/分位数，另外返回最多 32 条 probe；两者不混算。`precheckOnly` 与 `execute` 分开。超过 256 后分位数是滚动窗口，不代表全生命周期分布。
- 同时最多 32 个比较上下文，10 秒后取消旁路上下文；HTTP 超过这个时间仍记录其真实完成时长与结果。Worker 的 `workerCounters` 是内部连接/比较统计，包含内部取消，**不能用作真实 HTTP 成功率分母**。
- `httpMs` 在主线程完成回调入口固定，排除开始消息构造与后续比较；`beginQueueMs`、`observerQueueMs`、`compareMs`、`localReadMs` 分开。Worker 读簿发生在开始消息被处理时，可能晚于实际 HTTP 发起，不能将该快照直接当成发单时可用性证明。
- epoch/线路失效保留 HTTP 证据，比较标记 `epoch_or_route_changed`；退出为 `scope_stopped`；超限为 `attempt_capacity`；观察超时为 `observer_timeout`。没有比较证据不等于验证通过。不同时间戳/同毫秒多状态分别标记不能对齐/歧义。
- 停止 scope 后不继续展示其报告、不跨账号合并；仅已捕获的 finish 闭包允许更新旧对象的有界私有统计。需保留跨会话数据，应在结束前导出；本轮没有自动上传或永久保存用户诊断数据。

## 5. 生产旁路灰度放行范围

允许范围：已保存 `optimized`、登录且 ready、官方 market WS、direct HTTP、direct submit、官方账号 gateway、无账号代理，且显式打开本机 `changmen:pm:ws-book-shadow=1`。启停方法和导出命令见 [实施计划 12.2](../PM_DYNAMIC_WS_PREFLIGHT_PLAN.md#122-本机旁路开关及取证)。经典用户不用准备、迁移或更改配置。

上线后先确认报告 `worker:true`、`executionSource:existing-http`、`activeSupported:false`，有快照和 probe。生产 CSP 阻止 Worker、持续无快照/无 probe、反复 `processing_budget`/`worker_failed`/`observer_timeout`、可对齐差异或用户侧卡顿时，关闭旁路并保留报告；不以“改用 WS 下单”处理问题。即使旁路失败，实际预检仍走 HTTP。

线路设置没有同标签页统一事件，开启旁路后每秒轮询；后台标签页可能延迟轮询，独立公共诊断流也可能暂时延续。登录/账号/模式变更仍由主线程同步监听终止。不得把这项行为当成严格亚秒级线路切换保证。缺失资产按正常 60 秒周期重新获取，不保证快速补齐；静默丢包也不能靠无 sequence 的 WS 完全证明不存在。这些限制不阻止只读旁路灰度，但尚不满足真实快路径放行。

后续真实快路径需要另一轮明确授权、完整可执行算法同簿回放、用户设备/线路持续取证、双腿成功率/单腿暴露/延迟对照，以及独立启停和回退验收。本次不得打开真实快路径。

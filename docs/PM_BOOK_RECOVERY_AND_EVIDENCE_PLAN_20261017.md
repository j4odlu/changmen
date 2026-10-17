# PM 快照恢复与差异取证改造方案：参考 NautilusTrader

[changmen 扩展] 2026-10-17。**状态：设计稿，尚未实施。** 本次只阅读公开源码和现有实现、更新文档；没有构建、跑测试、启动浏览器观察、修改经典 FOK、启用开关或发布。实际预检继续 HTTP，两个现有开关默认关闭，当前生产旁路及真实本地预检均维持 **NO-GO**。

## 1. 建议与必须承认的边界

建议保留现有 PM-M、单 Worker、被动簿与动态消费者，补两项明确能力：**可独立回放的事故证据包；由行情所有者执行、按资产受控的快照恢复协议。** 不更换整套交易引擎，不把恢复放进 FOK 或消费者的 HTTP 回调。

实施先后为：取证闭环 → 无网络的恢复状态机与回放 → 单独评审主动订阅恢复 → 一轮有停止条件的浏览器验收。前两项可以保持原行情网络行为不变；主动恢复另有共享报价风险，不能把它包装为纯旁路观察。

**在“原共享订阅绝不改变、不开另一条连接、不用 HTTP 拼接 WS”的约束下，无法保证任意缺快照资产自动恢复。** 同连接退订再订阅可能中断该资产的原报价，即使完全不改 FOK 函数，也不能据此声称经典 FOK 的行情环境不受影响。因此本方案不把主动重订阅列为可直接上线的改动；当前先保留被动等待能力及 HTTP 实际预检。

现有事实见 [浏览器审计](./audits/PM_BOOK_BROWSER_CONTINUITY_AUDIT_20261017.md)：一个独立差异缺少当时完整原始证据；晚接入缺快照；60 秒之后新鲜快照覆盖约 37%–39%；原报价回放一致但旁路 CPU 有明显成本。这些事实分别对应取证、恢复、业务年龄和资源问题，不能统一归因于队列慢。

## 2. NautilusTrader 的可借鉴契约

固定参照 `nautechsystems/nautilus_trader@e1c7a7af5ae0b2a254dc303475e11663c3dd5762`，不是追踪浮动分支，也不等于认证某个发行版。

| 核实到的做法 | changmen 的对应设计 |
| --- | --- |
| `sync` 管逐资产同步状态，`recovery` 管异步恢复工作 | Worker 内 `BookSyncTracker` 决定状态；主线程行情所有者执行网络命令 |
| PM 没有簿连续序号，接受快照后才开放增量 | 延续现有快照门控；本地 `sequence` 仅证明浏览器内部交付顺序 |
| 同一资产只允许一个恢复持有者；退订与迟到事件要协调 | 以会话、连接、资产生命周期和恢复编号共同作废旧任务 |
| 发出订阅不等于恢复完成 | 必须由 Worker 接受本轮边界后的有效 `book` 才完成 |

依据：[模块边界](https://github.com/nautechsystems/nautilus_trader/blob/e1c7a7af5ae0b2a254dc303475e11663c3dd5762/crates/adapters/polymarket/src/book/mod.rs)、[同步状态源码](https://github.com/nautechsystems/nautilus_trader/blob/e1c7a7af5ae0b2a254dc303475e11663c3dd5762/crates/adapters/polymarket/src/book/sync.rs)、[恢复源码](https://github.com/nautechsystems/nautilus_trader/blob/e1c7a7af5ae0b2a254dc303475e11663c3dd5762/crates/adapters/polymarket/src/book/recovery.rs)。上述是契约借鉴，后文接口、预算和阶段安排均为 changmen 提案。

其 [PM 集成文档](https://github.com/nautechsystems/nautilus_trader/blob/e1c7a7af5ae0b2a254dc303475e11663c3dd5762/docs/integrations/polymarket.md#websockets) 还说明共享订阅下的迟接入恢复、hash 原像不足时不能验证，以及 Rust/Python 的运行环境。不能直接从它推出浏览器冻结后连续性、经典 FOK 等价或 changmen 的性能结论。其可重试错误分类值得参考，但浏览器的 WebSocket 发送结果并无服务器订阅确认，不照搬为相同保证。

## 3. 现有架构落点与复用范围

下面路径均相对仓库根；标为新增的文件目前不存在。

| 落点 | 现有能力直接复用 | 拟增加的职责 |
| --- | --- | --- |
| `packages/venue-adapter/polymarket/realtime/ws.ts` | 原连接、心跳、重连、源 epoch | 主动恢复阶段才增加受限发送入口；不改变现有自动换线规则 |
| `…/quotes/marketQuoteHub.ts` | 多业务消费者资产并集、原报价广播 | 主动恢复阶段维护 desired/实际发送状态及补偿；不能通过伪造消费者反复全量登记来恢复 |
| `…/realtime/marketStream.ts` | 只读原始流及接收时间 | 保留无常驻录制；恢复控制边界需与原始帧有可核对的先后关系 |
| `…/realtime/orderBook/service.ts`、`serviceProtocol.ts` | 单 Worker、有界 FIFO、读租约、会话与资产撤销保护 | 内部恢复意图/进度消息、证据包导出；不把恢复权限暴露给深度租约 |
| `…/realtime/orderBook/bookReducer.ts`、`passiveBookFeed.ts` | 快照替换、聚合数量覆盖、零数量删除、整帧原子处理、资产失效 | 记录明确的输入位置、快照事件类型和校验结果；保留原始字段给取证器 |
| `…/realtime/orderBook/bookStore.ts` | 不可变历史、核心签发的证明、资产级完整性撤销 | 撤销前捕获事故引用；统一返回事故编号及是否实际撤销 |
| `…/realtime/orderBook/bookSyncTracker.ts`（新增） | 复用现有代次和失效事件 | 纯状态转换、等待期限、单资产恢复占有和取消 |
| `…/realtime/marketBookRecovery.ts`（新增） | 调用原 PM-M 所有者 | 主线程调度、预算、两次发送的补偿；不另开 WS |
| `…/realtime/orderBook/bookEvidence.ts`、`bookEvidenceProtocol.ts`（新增） | 复用原输入与不可变状态 | 有界环形记录、事故冻结、完整性标记、白名单导出 |
| `…/submission/preflight/optimized/wsBook/bookRuntime.ts` | 公开 HTTP probe、已有参数及其原始时间 | probe 提供完整公共响应证据；精确比较及事故去重，不持有恢复连接 |
| `…/marketData.worker.ts` | FIFO 装配与单写入者 | 装配 tracker/recorder，统一状态和事故消息，隔离诊断异常 |
| `client/web/src/runtime/pmMarketData.ts`、`pmBookSettings.ts` | 应用授权、模式/线路判断、同步停止 | 承载独立诊断/恢复授权；经典模式不创建新任务或资源 |

**可直接复用的主要是 changmen 已有模块。** Nautilus 的 Rust/Tokio、锁和连接池不能作为 Vue/Worker 的可插拔实现；本方案按公开契约自行实现 TypeScript 状态机，不复制其交易、金额、订单恢复或风控逻辑，不引入 Nautilus 服务端。现有 SDK 的公开事件类型可继续复用；没有查到当前安装包可直接承担“注入既有原始流并自动恢复”的完整簿组件，不承诺存在即插即用库。hash 原像序列化也不能用订单签名 hash 工具替代。

## 4. 逐资产状态机

跟踪器只决定旁路簿是否可信及是否需要恢复，不决定任何真实订单能否执行。

| 状态 / 事件 | 动作与后继状态 |
| --- | --- |
| 新准入资产 | `waiting_snapshot`；记录一次等待起点；快照前增量忽略，不能续命期限 |
| 接受完整快照 | `live`；记录原始快照接收时间、输入位置和校验等级；随后正常归并增量 |
| tick、可定位坏帧、被核心确认的差异 | 撤销对应资产证明和元数据，进入 `waiting_snapshot`；可发出一个恢复意图 |
| 无效帧涉及多个资产 | 延续现有整帧原子规则，撤销所有涉及资产，不扩散至健康同伴 |
| 获得恢复占有 | `queued` → `cycling` → `awaiting_snapshot`；并发触发合并到同一恢复编号 |
| 等待期有效快照到达 | 核验所有本地边界后进入 `live`，结束本轮任务；不能由发送成功/BBO/成交/HTTP 响应完成 |
| 快照无效或本轮期限届满 | 有预算则进入 `backoff`，否则 `exhausted`；仍不可由增量恢复 |
| 资产移除、会话撤销、线路/连接更换 | 撤销对应旧任务；迟到命令、HTTP、快照证明和导出消息不能复活旧状态 |
| 无法定位的坏输入、内部交付间隙、队列/Worker 故障 | 延续整体失效；资源故障停旁路，不以重订阅风暴补救 |

`live` 表示有结构有效的簿，**不代表动态候选合格**。接收 ≤1s、快照 ≤60s、参数 ≤60s、源时间范围及 20ms 全输入读取契约均保持现状。快照老或市场安静不自动等于损坏，不能每过 1s 就恢复订阅，也不能把增量、HTTP 时间改写成 `snapshotAt`。

内部请求建议形状（仅设计类型，不是生产 API）：

```ts
type RecoveryIntent = {
  sessionId: number;
  streamEpoch: number;
  asset: string;
  assetIncarnation: number;
  invalidationVersion: number;
  recoveryId: number;
  reason: "initial_snapshot_missing" | "tick_changed" | "invalid_snapshot" | "integrity_suspect";
  afterFrameSequence: number;
};
```

`assetIncarnation` 在准入、移除再加入时单调分配，`invalidationVersion` 每次撤销推进；不能拿“当前无簿时返回 0”充当生命周期标识。任务领取、是否仍有需求、接受快照、取消在 Worker 单写入者内串行决定；网络持有者在发送前再查最新授权及需求。进度消息必须携带相同保护字段，旧 `recoveryId` 无权改变新任务。

新快照只恢复簿，不恢复已撤销的执行参数。目标参数仍由现有合格 HTTP 来源产生，保留原获取时间、资产与代次，并满足撤销屏障；健康同伴的簿、参数及在途工作均保留原时间。不能以“恢复完成”给旧参数续命，也不为经典 FOK 增加取参等待。

## 5. 快照恢复路径和共享订阅风险

### 5.1 可以保持原行情行为的路径

1. 动态消费者重新挂载时直接读取仍存活的公共 BookStore；消费者卸载不销毁簿，复用现有 warm pool 与原时间，不能重新盖新鲜时间。
2. 同连接自然到达的新 `book` 可以恢复对应失效资产；原 PM-M 因自身规则重连时，按新 epoch 清理旧证据，再等待新快照。恢复模块不能自行触发全连接重连。
3. 未启用前本来没有历史录制，晚接入不得假造已捕获最初快照。若以后设计检查点回放，只能回放真实保存的快照及其后**无缺口**的输入；溢出即放弃，不无限缓存，也不让经典模式常驻录制。

以上不能解决所有迟接入，需要明确显示 `waiting_snapshot/recovery_unavailable`，实际预检照常 HTTP。

### 5.2 主动路径：由 PM-M 所有者执行单资产 cycle

仅列为后续独立实验变更，新增恢复开关默认关闭且依赖现有明确的动态授权。步骤为：

1. Worker 为仍在授权资产集合内的目标领取唯一恢复编号，撤销其旧证据；健康资产不动。
2. 主线程确认目标仍属于原行情 desired 集合、是官方源且 epoch/会话/资产编号仍有效；拒绝扩大订阅集合。没有网络恢复授权则返回 `unavailable`，不循环排队。
3. 原行情所有者串行发送目标资产的 unsubscribe/subscribe，并在相同输入通道记下发送边界。不得借 `registerPolymarketQuoteAssets()` 的全量 initial dump 行为伪装为局部恢复，也不能假设重复 subscribe 一定补发快照。
4. 边界消息与帧进入同一个有界 FIFO；Worker 确认边界后的有效 `book` 才开放目标增量。发送边界只是本地顺序，没有 PM 请求编号或连续序号，不能证明该快照是服务器对本次请求的唯一响应；该限制写入证据等级。
5. 取消要区分“取消簿恢复等待”与“恢复原有行情订阅”。如果 unsubscribe 已发送，即使关闭旁路或切经典，所有者仍须根据**最新 desired 集合**补偿 subscribe；若业务已无需求则不重订。不能让取消标记把原行情遗留在退订状态。换连接后由新连接的原有登记流程接管，旧任务不得向新 socket 补发。
6. 在 unsubscribe 前切经典直接取消；中途切经典立即停止旁路并交回订阅补偿，**不让经典订单等待补偿完成，不增加拒单门控**。这仍可能存在短报价间隙，所以单靠模式判断无法证明零影响，须另行评审共享源行为才有资格实施/启用。

不增加第二个 WS，不改原报价提取/去旧/广播顺序，不因单资产失败重启整个 PM-M；也不引入 FOK 执行中的等待锁。若必须严格保证共享原行情完全不改变，应停在 5.1，不启用 5.2，接受覆盖率上限。

### 5.3 初始调度预算（提案，非官方限额）

| 项目 | 建议初值与行为 |
| --- | --- |
| 等快照 | 初次等待及每次发送后的等待各 10s；以原始单调时间计算，增量不能延长 |
| 并发 | 每资产最多一个 owner；全局最多 4 个等待恢复，最多一个 cycle 在执行发送 |
| 发送节奏 | 每 2s 最多一个单资产 cycle，burst=1；这不是交易所公布的额度 |
| 单次事故 | 最多 3 次尝试；间隔 2s、4s，加不超过 20% 抖动；排队最长 120s，发送等待与排队分别计时 |
| 预算耗尽 | `exhausted`，至少冷却 60s；首版不自动无限重试，由新授权/明确重试或自然快照解除 |
| 取消 | 退订、切模式、退出、线路变化取消旧等待；已经产生的原订阅补偿义务由网络所有者处理 |
| HTTP 404 / 失败 | 只作为独立 probe 结果；不凭一次 404 删除原行情资产或触发整源恢复 |

先只恢复缺初始快照、tick 与损坏。**60s 覆盖率问题仍需单独决策**：即使首次恢复成功，运行超过 60s 也可能再度过期。若以后要求持续新鲜快照，可设计低优先级 `freshness_refresh`（例如 55s 后申请）并共用上述预算；它会增加订阅扰动，首版不启用，不能拿它当作放宽年龄阈值的替代手段。安静市场即使刷新快照，也未必持续满足 1s 的动态接收条件。

### 5.4 浏览器后台与恢复前台

- 单纯 `hidden → visible` 不重建 Worker、不重订阅、不改接收/快照时间；继续按真实输入和原年龄判断。不能把“回到前台”当成获得新快照。
- 明确发生 freeze/resume、BFCache 恢复或内部队列间隙时，保守撤销本地连续性证明、取消旧恢复等待和旧 HTTP 工作，再按现有应用授权进入等待快照。只撤销旁路，不强迫原 PM-M 断线，也不让经典订单等恢复。
- 页面被丢弃/重载时启动新会话，旧包可作历史取证，不能加载成新鲜执行簿。没有明确生命周期事件的暂停仍由现有队列年龄、源时间和预算保护识别；不宣称能检测所有操作系统休眠。
- 超时以保存的单调截止时间为准；恢复运行时先处理已过期和取消状态，不补跑所有错过的 timer，不突发重订阅。仍保持全局预算，订阅补偿义务由当前网络所有者检查。

这部分需要浏览器专用实现，不能直接复用 Nautilus 的服务进程任务生命周期。

## 6. 差异取证：先保存可解释的输入，再撤销

当前 `probe()` 持有完整响应和前后历史，但 `record()` 只留下小摘要；`reportIntegrity()` 随后清空资产。需要补齐这段断点，而不是延长首段全量录制。

### 6.1 捕获事务

1. HTTP probe 开始时记录 asset/market、所有代次、前一输入位置、不可变本地检查点和原始获取时间；只针对现有公开 probe，不增加经典 HTTP 钩子或请求。
2. probe 响应保留**有界公共原始 body**及完成时间，再解析为候选。现有读取器已限制响应字节，拟增加诊断返回封装，普通解析路径保持兼容；不从已转成 `number` 的 asks 重造原始 body。
3. 每个输入保存 epoch、帧位置、到达时间、处理顺序、原始帧及归并结果；恢复控制、资产集合、失效、生命周期事件同样带序位。跨资产帧保持整帧，不裁成无法复现原子性的局部片段。
4. 差异触发时，Worker 在撤销之前冻结检查点、输入窗口、HTTP 和比较结果的引用；同步阶段只做有界引用领取。核心仍验证其签发的旧证明，之后立即执行原资产撤销，不等编码、hash、下载或写盘。
5. 后续任务分块编码和导出。录制/导出失败仅标记 `evidence_incomplete`，不能吞掉差异、阻塞实际 HTTP、恢复参数或阻止资产失效。不得在每个 1s 诊断报告中复制整簿/原始流。

建议版本化证据包至少包含：

```text
schemaVersion, incidentId, build/source/worker hashes
sessionId, streamEpoch, assetIncarnation, invalidationVersion, recoveryId?
asset, market, trigger, observedAt, lifecycle, route(public enum only)
checkpoint: full bids/asks as strings, sourceAt, snapshotAt, revision, inputPosition
input: raw frame/control records, first/last positions, timing, reduction outcomes
http: public body, status, start/end times, start/end input positions
comparison: all same-timestamp candidates, evidence level, diff of both sides
hash: algorithm/preimage availability/result, raw values, no invented defaults
action: invalidated assets, cancelled work, recovery result
completeness: checkpointPresent, contiguous, truncated, dropped, sizeLimit, captureAborted
```

来源是公开 market 数据和公开 `/book`，不记录账号、签名、余额、Cookie、Authorization、代理凭据、真实订单参数或私有 user WS。初版仅内存与手动 JSON 导出，不增加后端/RDS 写入或上传。

### 6.2 有界保留和性能

建议全 Worker 共用一个约 1MiB 原始窗口、一个最多 4MiB 的冻结事故包、一个活动 probe 检查点；至多保留首个未导出的完整事故，后续只计轻量事故摘要并明确“证据容量已满”。目标窗口为最近 10s，字节上限优先，不能承诺高流量下必有 10s。

预算按实际编码字节及被保留对象分别核算，不能把 1MiB 字符串称为只占 1MiB 堆。HTTP 原 body、不可变 Map 被引用而无法回收的额外状态、序列化临时副本均计入诊断内存估算；到顶立即释放或中止捕获，标记不完整。允许临时编码一个原已受限的输入单元，完成后释放，不保留无界双份记录。保留现有 16 资产/每侧 2,000 档/4 历史及 FIFO/CPU/20ms 读限额，不通过扩容修复覆盖。

窗口必须有可衔接检查点；环形淘汰破坏衔接后，要么在预算内建立新检查点，要么声明不完整。若一个合法大快照已占满窗口，不能遗漏后续输入仍标“连续”。证据过大或生命周期中止可以导出部分包，但部分包不能支持已定位根因的结论。

关闭诊断即解除录制；经典模式不启动 recorder、probe、恢复 timer 或额外连接。导出与包摘要只能异步尽力完成，退出/切经典不等待。完整包传到主线程后可供手动下载；Worker 在传出前退出则明确丢失，不宣称崩溃持久化。若日后需要自动落盘，再单独设计存储与保留策略。

## 7. 比较等级与 hash：不把毫秒当序号

保留原始十进制字符串和档位顺序用于原像核对；另建精确十进制规范形式比较价格/数量，比较双边完整深度、身份与覆盖范围。`0.50` 与 `0.5` 可以在数值比较中相等，但不能因此改写 hash 原像。用纯函数精确比较，不以浮点转换后的相等掩盖原始差别；仍属于诊断，不改经典价格/深度运算。

| 分类 | 可得出的结论 / 行为 |
| --- | --- |
| `snapshot_hash_verified` | 仅当全部必要原像、序列化规则和算法有确定依据且本地重算一致；证明该快照内容，不证明后续增量连续 |
| `snapshot_hash_unverifiable` / `hash_absent` | 缺字段或无 hash；可以保留结构有效行情，但不声称已校验。现有 `snapshotEvidence` 表示收到非空 hash，不能被升级解读为已验证 |
| `snapshot_hash_mismatch` | 原像充分且确实不一致，拒绝该快照并撤销目标；记录完整计算依据 |
| `timestamp_observed_equal` | 只证明 HTTP 与已保留的同时间状态一致，不证明交易所连续性 |
| `timestamp_observed_difference` | 保存全部候选与双边差异，延续保守撤销；根因仍待回放核实 |
| `ambiguous_timestamp` / `unaligned` | 同毫秒存在多个状态或没有可比状态，单独统计，不算一致、不直接归因丢帧 |
| `capture_incomplete` / `probe_failed` | 证据不完整或 HTTP 失败，保留缺口，不能用于通过率凑数 |

新增 `snapshotValidation` 等诊断字段，不能悄悄改变当前候选门槛。HTTP 快照不得灌入公共 WS BookStore 并重放“时间戳较大”的增量：无交易所序号时，时间戳不足以证明衔接。可以维护隔离的 HTTP 对照状态，但其来源必须一直写明 HTTP。

事故使用唯一 `incidentId`。分别记录 `comparisonObserved`、`assetInvalidated`、`recoveryRequested/Completed/Failed`，核心返回是否真正撤销；同一事故的 outcome 与失效监听不得再累加为两次差异。旧审计保留原始计数与修正说明，不回写成零。

## 8. 用回放收敛问题，停止随机构建循环

拟新增 `scripts/verification/pm-book-incident-replay.mjs`，消费版本化证据包，通过仓库现有 TypeScript 运行方式调用纯归并/状态转换；不另写第二套期待结果与实现互相证明。输出每步状态、首处分歧输入、同毫秒候选、差异档位和可核实的证据边界。

一次完整回放分两层：先验证生产 reducer/tracker 能否复现捕获时本地结果；再用独立、简单的聚合簿检查器从同一原始检查点和输入重建，区分比较器、归并、资产切代和内部投递问题。独立检查器不能只调用生产 reducer 包一层，也不能声称独立收到交易所数据。证据无法解释服务器内部差异时，输出 `unresolved`。

需要固定的有限样例为：缺初始快照、tick 后只来增量、坏快照后有效快照、移除再加入/旧 HTTP 迟到、恢复时重连、退订后取消补偿、跨资产坏帧、同毫秒多状态、hash 原像不足、录制溢出、Worker/页面恢复。样例中每个状态转换有明确预期；不反复更换随机市场寻找绿色比例。

此前真实差异缺原 body 与完整输入，**无法靠新回放补造其历史根因**。后续可解释新捕获事故、验证比较契约，但旧差异继续保留。只有取得新的因果证据并记录处理依据，才讨论更新放行判定。

## 9. 实施顺序与完成条件

| 阶段 | 交付 | 停止条件及边界 |
| --- | --- | --- |
| A：取证闭环 | recorder/协议、probe 公共原文、撤销前冻结、事故去重、精确双边比较、离线回放 | 先证明包可重放且缺失可识别；不改 WS 订阅或 FOK；不需要长期浏览器 soak |
| B：恢复状态机 | tracker、代次/占有/取消、只读恢复需求与禁用原因；使用已有历史和有限故障样例 | 网络执行器仍为空；不能把“能请求恢复”记成“已恢复” |
| C：主动恢复独立评审 | PM-M desired/实际状态、受限 cycle、FIFO 边界、补偿、预算及默认关闭开关 | 必须先接受并证明共享报价影响边界；严格零网络变化要求下停在 B |
| D：一次有限验收 | 固定构建、名单和阶段；冷/晚接入、原生后台/前台；固定输入报价对照、资源和覆盖拆分 | 预先写死时长及性能预算；差异或预算失败立即停止，不再拉长观察碰运气 |

阶段 D 前建议冻结一个可审查的初始性能预算：固定同输入下原 handler P99 增量 ≤0.1ms、测试浏览器进程 CPU 累计增幅 ≤20%，证据开启相对相同旁路再增加 ≤5%；同时保留现有硬资源和读取限额。**这些是拟议产品预算，不是官方标准或本次已通过的指标**；上一版 CPU +135.03% 显然尚不满足该提案。预算若有不同业务取舍，须在观察前改定，不能看到结果后放宽。测量必须同时给绝对 CPU 毫秒、输入量和计时粒度，不能只用比例或把它写成整机 CPU 使用率。

覆盖率分开报告：结构有簿、快照未过期、恢复成功/耗时/排队、满足全部动态政策、HTTP 结果。固定名单的退市/404/单边仍在总分母，另列分类；“可响应资产的恢复成功率”可以另报，但不能替换总覆盖率。主动恢复成功也不等于实际预检命中或双腿成交。

将来真正触及共享链路时，按仓库约定运行相关行为回归、`node scripts/verification/verify-fok-execution-parity.mjs`、`npm run check:fok-vps`；前端实施再过类型检查。**本次没有运行这些命令**，也不把前次通过记录冒充本方案验收。

## 10. 当前决定

可以直接采用 Nautilus 的职责分离、单资产快照门控、唯一恢复持有者和“收到有效快照才算恢复”的契约；已有 Worker、FIFO、不可变历史和资产撤销直接复用。浏览器取消与生命周期、共享 PM-M 的订阅补偿、取证格式/有界录制/回放、精确比较与 hash 原像核对，需要 changmen 自己实现。

建议下一次实施仅做 A，然后 B；C 在共享报价影响有明确结论前保持禁用。当前不继续反复构建测试、不动经典 FOK；实际 HTTP、默认关闭、未发布与 **生产旁路 NO-GO** 均不变。相关上文档：[外部实现研究](./PM_ORDER_BOOK_EXTERNAL_DESIGN_REVIEW_20261017.md)、[共享簿方案](./PM_SHARED_ORDER_BOOK_REFACTOR_PLAN.md)、[动态预检方案](./PM_DYNAMIC_WS_PREFLIGHT_PLAN.md)。

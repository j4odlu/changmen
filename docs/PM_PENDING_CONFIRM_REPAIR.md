# PM 延迟订单核验修复（2026-09-29）

[changmen 扩展] 修复迟到 WS 回执丢失、旧订单复核窗口偏移的问题，并按用户明确授权，定向恢复 `051ae854` 前买入腿“核验耗尽按未成交处理、允许补单”的退出策略。不是整笔 Git revert。

changmen 的 PM 下注使用 FOK，业务结果只有整笔成交或整笔未成交，不存在“部分成交”业务状态。核验期间为待确认；买入腿核验耗尽且没有已知成交证据时，按本地策略返回 unfilled、清除 pending，进入现有补单条件判断。消息明确标注“超时策略判拒（非官方拒单回执）”，保留原始响应。手动卖出不应用该买入策略。

## 当前行为

- 已恢复原 `coercePolymarketFokPollOutcome()` 的签名与映射：matched → matched，其余 → unfilled。买入收尾入口通过 `applyPolymarketBuyTimeoutPolicy()` 调用，保留成交证据检查和本地策略日志。已移除本轮新增的 15 秒总预算，恢复原订单轮询和成交复查的次数、间隔。
- 下单前预连账号级用户 WS（无市场过滤），按鉴权会话短期缓存 ACK 前的事件。等待超时保留订单监听，迟到事件仍可更新结果。
- 确认阶段使用持续事件监听；首次 Promise 超时后，新的成交/取消仍立即触发处理，不等下一轮轮询。重连完成后立即并行补查原单与成交，恢复流程不依赖 conditionId。事件复核单飞，收尾后解除监听，避免残留复核与撤单。
- 原始提交时间随待确认队列持久化。刷新或重试按原时间计算剩余延迟与成交查询范围，不重复等待整段 delay。
- 官方延迟窗口结束后，按有限次数轮询和复查收尾，不设 15 秒总截止；单次读取最多等待 3 秒，避免网络请求永久挂起。订单和成交记录并行查询，HTTP/鉴权错误保留为错误，不伪装成空记录。
- delayed 不撤单。明确 live/unmatched 且无成交时，才尝试撤销原单，并复核撤单回执、订单和成交记录。取消回执必须对应原订单 ID。
- FOK 回执数量不一致时归入确认异常，继续核验整笔结果。当前买入 FOK 对应的唯一 taker trade 返回 FAILED 时，按官方永久失败确认 unfilled；查空、404、本地超时仍不是官方拒单证据。
- 买入腿核验耗尽后按已授权的超时策略退出待确认；后台 Job 和刷新恢复后的 fallback 使用同一个策略入口。已知成交证据优先，不能覆盖为拒单。
- 原单 ID、提交时间、赔率、金额和异常信息持久化；日志不再把其它订单当作本单证据。

## 验证与限制

提交前最终验证：账号级订阅、持续监听和重连补查优化后，92 个相关前端测试文件、771 项测试通过；生产构建（包含 vue-tsc 类型检查）、客户端/服务端边界和 adapter 检查通过。后端 PM 客户端接口测试 14 项此前通过，后续未再修改后端源码。构建仍有分包循环、包体积和静态资源路径警告。以上为离线验证，真实订单回执时延尚待部署后观察。

再次复核（2026-09-29）：修复首次 WS 等待超时后、成交复查阶段迟到零成交取消未及时消费的问题；复核时优先处理竞争成交。买入收尾对最新成交快照保持优先，并防止数量不一致的快照绕过整笔确认检查。新增 5 项回归，相关前端测试合计 92 文件、769 项通过。当前没有 15 秒总截止。

官方资料复核：
- [Place Orders](https://docs.polymarket.com/trading/place-orders)：delayed 是受理未撮合，官方建议跟随用户流；`waitForOrderFillSettlement()` 仅等待已有 tradeIds 的链上结算，不等待 delayed 撮合。
- [Real-Time Order Updates](https://docs.polymarket.com/trading/realtime-order-updates)：支持无市场过滤的账号订阅；断线不保证补发所有消息，重连应补查订单与成交。
- [Manage Orders](https://docs.polymarket.com/trading/manage-orders)：成交可通过 taker_order_id / maker_orders.order_id 关联原订单；可用 builder trades 为带 builder 归属的订单增加成交核对来源，但查空不证明拒单。
- [Order Lifecycle](https://docs.polymarket.com/concepts/order-lifecycle)：delay 窗内不可撤销；MATCHED 与链上 CONFIRMED 含义不同。
- [Error Codes](https://docs.polymarket.com/resources/error-codes)：官方 `order timed out` 表示入簿前拒绝；本地请求超时不能等同这一回执。

后续优化已实现：账号全市场订阅、确认期持续事件监听、重连立即补查；首次等待超时后的取消回执在模拟测试中到达后 1ms 内完成本地处理（HTTP 为立即返回的 mock，不是生产 SLA）；重连可以在原定 30 秒轮询等待前确认漏掉的成交。仍未实现：页面关闭后的服务端持久跟踪、超时策略退出后的完整后台对账与迟到成交业务纠正、链上 CONFIRMED/FAILED 全生命周期追踪。这些不能通过本次客户端优化宣称已经解决；现有本地超时退出仍不等于官方拒单。

部署前复核补修两处边界：切换 User WS 消息源后不再遗留跳过重连标记，替换连接后续断线仍自动重连并恢复市场订阅；取消帧的空白 `size_matched` 不再按零成交处理。新增回归覆盖这两条路径。2026-09-29 最新相关前端回归为 92 文件、764 项通过，后端 PM 客户端接口测试 14 项通过；边界、adapter、client-core 检查通过。后续已移除 15 秒参数，恢复旧版重试参数；仍保留 WS/REST 并行和迟到回执修复，不是整文件回退。

后续收敛修复：官方 WS 明确零成交取消触发立即短复核，最多等待 3 秒发现竞争成交证据；即使 REST 查空，不再丢弃官方取消回执。底层保留 timeout 事实，买入业务层单独应用超时判拒策略。未完成核验的队列仍由单飞任务控制。

新增 `PM 原单时序` 日志：submit、ack、watch、ws_event、ws_open/ws_close、ws_timeout、lookup、decision。按 accountId/orderId 关联，ACK 附原提交时间和 Link；缓存事件保留真实接收时间。仅记录白名单字段，不记录凭证、签名、原始响应或错误正文。日志上报失败不影响交易。它是后续在线验证的诊断手段，不是持久化成交事实的替代品。

新增实际 watcher + settlement 联动测试（模拟网络）：首次监听超时后取消回执仍能结束确认、WS 断线时 REST 成交能结束确认、重连恢复原市场订阅。另验证取消与成交竞争、REST 挂起时取消短复核上限、日志字段脱敏。

2026-09-29 定向恢复退出策略后的本地验证：92 个测试文件、759 项回归通过，覆盖后台 Job 超时、恢复续查超时、套利收尾不再 pending、下一轮可以补单，以及已知成交证据不被判拒。类型检查、客户端/服务端边界、adapter 导出与导入检查通过。电竞冻结检查按本次 PM 修复范围显式放行，未改冻结清单。这些是模拟和静态验证，不是生产时延 SLA；未部署，也未进行真实下注/撤单验收。

回归覆盖迟到/提前 WS、账号隔离、取消与成交竞争、延迟不可撤、查询失败/挂起、旧订单恢复、FOK 回执数量不一致、账号阻断与解除，以及后端按原订单 ID 查询。

当前无 15 秒总预算，也没有“提交后固定 8 秒拒单”。实际时长由官方延迟、有限重试次数和网络耗时决定。超时策略允许补单不代表已证明原单未成交，仍存在原单迟到成交导致重复敞口的风险，这是本次用户授权恢复的策略取舍。MATCHED 表示已撮合敞口，不等于链上 CONFIRMED。本次未增加链上最终性追踪。

本次只修改代码和离线测试；未部署、未发起真实下注或撤单、未强制修改历史订单状态。

## 2026-10-09：唯一 BUY FOK trade 的 FAILED 拒单依据

[changmen 扩展] 按用户授权，把原订单唯一 trade 的官方永久失败纳入 PM 拒单检测。此处的业务“拒单”包含撮合后的交易永久失败；不把 FAILED 描述为“从未撮合”。

### 依据与实际查询发现

- [官方订单生命周期](https://docs.polymarket.com/concepts/order-lifecycle#trade-statuses)：FAILED 是 trade 永久失败终态，MATCHED / MINED / RETRYING 尚非链上最终成功；CONFIRMED 是成功终态。
- [官方下单说明](https://docs.polymarket.com/trading/place-orders)：FOK 要求全部成交或不成交。
- [官方用户流](https://docs.polymarket.com/trading/realtime-order-updates)：trade 帧包含 id、taker_order_id、side、status，可精确关联原订单；FAILED / TRADE_STATUS_FAILED 采用同一语义。
- 2026-10-09 全历史只读查询：12,157 个格式有效订单号中，10,481 个各查到一个 trade（10,479 CONFIRMED、2 FAILED）；没有查到同订单多个 tradeId。买入成交的 9,501 个订单各有一个 trade，全部 CONFIRMED。两笔 FAILED 样本属于卖出，尚无买入 FAILED 实际样本。maker_orders 可有多条，但它们不等于多个 tradeId。
- 另有 1,676 个订单在 CLOB 查询没有 trade，其中 10 个通过官方钱包活动和链上 OrderFilled 的精确 orderHash 证实成交，剩余 1,666 个没有取得官方终态。查空不能当作官方失败。
- “当前买入模式观察到一单一 trade”是实证，不是官方保证所有 FOK 永远只有一个 trade 的接口契约。

### 检测规则与实现范围

1. 使用现有原单 WS 监听和 REST 拒单核验，不新增独立编排或补单流程。下单类型保持 BUY FOK。
2. FAILED 必须带非空 tradeId，side=BUY，taker_order_id 精确等于本单 orderId。只有 maker 关联、缺字段、其它订单或 SELL，不使用此规则。
3. REST 核验在现有成交查询中保留失败记录，按关联 tradeId 去重后只允许唯一 trade 的 FAILED。订单行另有其它 associate_trades 时也不能套用此规则。普通订单列表、成交金额和手动卖出查询继续过滤 FAILED。
4. WS 核验期间累计本单已知 tradeId，先汇总有效缓存及同批消息的 tradeId，再按顺序处理；REST 同时核对尚未形成终态的 WS 关联。尚未确认成交时，唯一 FAILED 立即返回 unfilled，不等轮询延迟或核验耗尽，也不额外撤单。同一 trade 的旧 MATCHED / RETRYING 不覆盖已确认的 FAILED；先收到 MATCHED 则按现有逻辑结束核验，不再检测其后 FAILED，也不把已经确认的 matched 改判拒单。
5. 保留 status=FAILED、associate_trades=[tradeId]、confirmationBasis=trade_failed，size_matched=0 表示最终没有有效成交份额，不抹掉发生过撮合的事实。订单行解读先识别该依据，避免非空 associate_trades 被旧逻辑误认作成交；展示“官方 trade FAILED”，与 timeout_policy 区分。
6. 后台 Job 和恢复续查消费同一个结果。保持原有 MATCHED 收尾、监听清理和 Job 缓存生命周期，不新增成交后的监控。FAILED 判拒返回现有 reject=unfilled，后续由现有编排层决定另一条腿和补单。超时判拒的次数、间隔和策略保持原设定。
7. 直连 PM 与 VPS 中转共用相同客户端解析、REST 核验和收尾函数，不改运输方式、服务端接口或 RAY 逻辑。

边界：唯一性判断基于当前核验窗口和已知证据，沿用现有 REST 分页上限；不能由此宣称历史查询永远完整。本次覆盖尚未确认成交的 delayed 原单核验和 ACK 前缓存。按用户明确要求，收到 MATCHED 后不继续检测 FAILED；页面关闭后的对账与历史订单纠正不在本次实现范围。不会因此宣称所有 delayed 最终状态一定都能取得。

新增模拟覆盖 WS 官方源/中转源、ACK 前 FAILED 缓存、首次监听超时后的 FAILED、REST FAILED 与旧订单行竞争、跨 WS/REST 已知 tradeId 核对、先收到 MATCHED 后忽略 FAILED，以及官方失败不会显示为本地核验耗尽。未部署、未进行真实下注/撤单、未改历史订单。

提交前审查补修：REST 读取期间收到的 MATCHED 和已成交 Job 不会被迟到 FAILED 覆盖；WS 同批多 tradeId 不会在首条 FAILED 时过早判拒；尚未形成 WS 终态的关联也参与 REST 唯一性判断。新增 6 项回归先复现问题，再验证修复。

本地最终验证：PM 全模块及套利腿收尾、补单订单、手动卖出恢复相关回归，72 个文件通过、1 个跳过，802 项通过、1 项跳过。vue-tsc、客户端/服务端边界和 adapter 检查通过。`settlementJob.ts` 已恢复到本轮修改前，没有新增 MATCHED 后监听或缓存生命周期改动。均为离线验证，尚未部署或用真实买入 FAILED 回执验收。

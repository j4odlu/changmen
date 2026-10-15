# RAY 订单监控

[changmen 扩展] `runtime.ts` 是唯一 RAY 后台订单监控调度和查询入口，负责用户端原单恢复、身份定位、HTTP 查询、本地状态更新、拒单事件和终态退出。监控不保存订单到 RDS，不调用订单持久化绑单或 `Client_GetOrderList`。登录会话启动，登出、切换用户、管理端预览或页面卸载时停止。普通、GTC 和体育 RAY 原单使用相同查询链路。

- 每 5 秒按投注账号查询一次 `/v2/order`，同账号多笔原单共用请求；在途请求不重叠。账号处于下注确认窗口时暂缓，窗口结束后继续。
- 每 60 秒通过 `Client_GetPlayerOrder({ rayMonitorOnly: true })` 恢复数据库未结原单，不限制日期；已知单号额外返回终态。恢复失败在下一轮重试，不阻止已知原单查询。
- 已知原单按账号和场馆单号精确匹配；首次确认后的待关联上下文沿用原时间、金额、赔率及文本评分规则，只接纳唯一候选。`monitorBound` 表示客户端已确认身份，`bindingSaved` 仅表示同步模块或数据库恢复已确认持久化 Link，两者分开。
- `localOrders.ts` 更新客户端已有订单的状态、赔率、投注额和盈亏，并重算当前列表统计。保留账号、Link、买入时间及 GTC/POD 身份；不新建账本行、不回退终态、不发 HTTP 请求。
- 订单落库统一由 `stores/account/venueOrders.ts` 的正常同步负责。成功保存后，`rayOrderBindings.ts` 处理已确认原单的持久化关联及失败重试，不重复保存订单或刷新侧栏。尚未持久化关联的终态上下文保留在 sessionStorage，供正常同步完成关联。
- `win / lose / return / reject` 为终态，客户端观察到终态后结束监控，不等待 RDS 保存。任务按用户保存在 sessionStorage；数据库仅用于恢复已保存的原单。
- 首次拒单检测仍按原下注等待和确认流程执行。它结束后只交接上下文；独立监控发现唯一确认原单的后续拒单时，`autoMakeup.ts` 按原扩展开关、自动补单开关、成功腿锚点、用户取消及队列冲突规则交给现有补单队列，不直接下注。
- 旧旁路查询及主循环 tick 已移除；`contexts.ts`、`contextStore.ts`、`match.ts` 不设置定时器或查询场馆，只消费唯一查询返回值。旧监控时长偏好已弃用，所有原单持续观察至终态。
- `contextStore.ts` 从旧 `changmen:ray-reject-monitor:v1:<user>` 迁移关联和补单依据，移除旧时间限制，保存成功后删除旧缓存键；普通原单缓存也继续兼容恢复。

`lifecycle.ts` 管理自身登录生命周期，`api.ts` 只负责读取恢复数据，`state.ts` 为共享展示状态。`orderMonitoring/rayState.ts`、`raySettlement.ts`、`rayLifecycle.ts` 仅兼容旧导入。GTC 消费已有 RAY 查询快照时不再保存订单或刷新列表；首次下注后的 fresh 确认链路保持原保存及刷新。

这是客户端模块，持续运行期间需要保持页面会话。RDS 的订单状态在正常订单同步时更新，不随五秒监控查询写入。

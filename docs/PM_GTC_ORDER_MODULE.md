# PM 单笔 GTC 订单模块

[changmen 扩展] 2026-10-27。GTC 是 PM 订单的执行类型。新订单直接保存单笔结构，不再构造双腿套利计划；业务筛选与订单维护分开。保留现有 GTC 签单方式，本批没有增加 Post-only 或 GTD。

## 当前边界

| 位置 | 职责 |
| --- | --- |
| `packages/shared/pm_gtc_order.ts` | 单笔订单参数、成交事实、精度及事实归并；无业务、UI 或存储依赖 |
| `client/packages/venue-browser/polymarket/gtc/` | PM 预检、签单、提交、原单查询、成交归并与撤单 |
| `orderModes/gtc/core/orderRecord.ts` | `formatVersion: 2`、`orderType: GTC` 的单笔记录和状态处理；没有另一腿、套利计次、配对完成或恢复套利 |
| `orderModes/gtc/core/orderService.ts` | 先持久化授权再首次发送，回执未知时只查询原单 |
| `orderModes/gtc/orderStore.ts` | 单笔记录原子持久化及已确认成交结果队列 |
| `orderModes/gtc/orderRuntime.ts` | 独立恢复、查询、WS 监听、撤单和失败写盘重试 |
| `orderModes/gtc/orders.ts` | 对业务公开的准备、提交、读取、刷新、撤单和订阅入口 |
| `orderModes/gtc/manual.ts` | 手动业务的账号预检、金额确认、显示上下文和通知 |
| `orderModes/gtc/api.ts`、`localStore.ts`、`runtime/gtcOrderMonitor/` | 只处理旧记录的读取、恢复、查询、撤单及对侧兼容；旧创建入口已移除，不再授予原始买单或对侧发送许可 |

路径未写前缀的客户端文件均位于 `client/web/src/`。新路径不调用 `GtcPlan`、`GtcExecution`、`singleOrderLegacyPlan` 或旧执行状态机。新单不再填空的对侧账号和 A/B 腿。原转换桥已删除。

## 订单和业务关系

`prepareGtcOrder(account, checkedOption)` 接收已完成账号预检的客户端订单选项，返回绑定账号和登录会话的冻结签单句柄。未来业务可以在自身入口映射输入，不能把选号、配对或补单规则放回订单核心。

`submitGtcOrder(account, prepared, context?, onReceipt?)` 只维护一张 PM 原单。可选 context 包含关联 linkId、展示用的 match、bet、item，以及调用方提供的可选 `clientMarket` 合场身份快照；不要求赛事 ID、盘口行 ID、另一腿或业务激活标记。订单快照直接来自单笔记录。合场身份仅用于追溯，不能驱动订单发送、对侧执行或财务计算。

业务关联属于调用方；GTC/FOK 类型不决定业务来源。一张原单可以包含多笔成交明细，累计结果仍更新同一张订单。日志观察异常不能把已经记录的回执改为未知，也不能触发重发。

## 本地格式及旧客户端

沿用 `changmen_gtc_client_v1`、数据库版本 1 以及 `records`、`results`、`meta` 三个 store，不升级或清空用户数据库。

旧记录 envelope 为 `{key, owner, hashKey, row: GtcExecution}`；新记录为 `{key, hashKey, order: GtcOrderRecord}`，key 使用明确的 `order-v2` 命名空间。新记录的 owner 在 order 内部，旧客户端通过顶层 owner 索引读取时不会误读新格式。新读取通过 owner 的 key 前缀范围取得自己的单笔记录。

两个格式共用原 `hash` 唯一索引，继续按 owner、账号和签单哈希防止重复创建；旧客户端和新客户端也不能为同一签单各发一次。新记录同时保留持久化的一次发送许可和页面发送者身份；刷新、并发标签页或查询失败不会重新取得发送资格。

旧记录不批量重写。旧公共创建入口已移除，旧命令接口拒绝新的发送授权。测试中的旧写入器位于 `src/test/legacyGtcWriter.ts`，仅模拟旧版客户端验证存储兼容，运行时代码不使用它。

## 公共订单及财务

本地记录维护提交和挂单状态。GTC 受理后即通过现有同步协议写入公共 RDS `orders`，以原 orderId 和账号定位，直接复用普通订单的展示、拖动和 Link 改绑。同一原单的部分成交或 FAILED 修订更新原行，并保留手动改绑后的 Link。

受理时附带原单份额和限价；尚无已确认成交时，成交份额、成本和费用为零，不计入成交笔数、持仓或盈亏统计。费用未知及中间成交状态继续等待确认，不预先计算财务金额。旧客户端的成交结果协议仍可使用，本地已有受理原单在启动时补入同步队列，不重发订单。

原单核实为零成交且已终止时，沿用普通订单 `Return`（退）状态；部分成交后取消剩余挂单，已成交部分仍待结算。状态变化同样进入同步队列，不能只比较成交金额。已有已核实的本地记录可立即修正展示，后台同步更新原行，不改写已结算输赢。

若后续核对发现尚未最终确认的迟到成交，已终止原单显式同步 `None`，即使已确认财务份额暂为零，也撤回先前的零成交 `Return`。只有完整核对确实没有成交后才再次显示“退”。

新写入的 GTC 买单附带 `pmOrderType: GTC`，接口展示为可选 `PmOrderType`；缺省的现有 FOK 行保持原字段和识别方式。原 `pmGtcExecutionId` 等身份字段保留为线协议和历史数据的字段名，不再表示新订单依赖双腿执行结构。

金额、费用舍入和汇率沿用原 PM 财务助手；普通 FOK 下单、补单、自动卖出和配置沿用原行为。订单汇总只增加零成交 GTC 的排除条件。旧 GTC 的订单标识继续保护原单，不能让普通自动卖出或普通同步接管其未确认结果。

[changmen 扩展] GTC 买入成交与卖出回款共用成交状态规范化：兼容官方 `TRADE_STATUS_*` 和无前缀形式，转换后只保存内部状态。`MATCHED_NOT_BROADCASTED` 归为尚未最终确认的 `MATCHED`，`MINED` / `RETRYING` 同样不作为最终成功；`FAILED` 不计成交或净回款，只有 `CONFIRMED` 成交可计入最终成功份额和回款。未知值继续阻断。依据：[成交接口](https://docs.polymarket.com/api-reference/trade/get-trades)、[用户实时事件](https://docs.polymarket.com/trading/realtime-order-updates)。

GTC 费率和曲线参数在查询边界统一校验：合法数值零可以证明免费，空字符串、布尔值、数组及其它畸形字段均保持未知，不能借 JavaScript 数值强转生成零手续费。

## 市场交易资产

[changmen 扩展] 按 [PM Market Details](https://docs.polymarket.com/market-data/market-details) 的 `version` 选择交易资产：`v1` 解析 `clobTokenIds`，`v2` 使用数组 `positionIds`，两组字段同时存在时也不混用。统一入口为 `@changmen/shared/pm_market_assets`，覆盖采集索引、行情、下单前市场核对、历史订单与赛果。ID 始终保留十进制字符串精度；V2 字段缺失、格式错误或不支持的版本不回退到 CTF。旧无版本且没有 V2 字段的 CTF 快照保留兼容。

索引的 `homeTokenId` / `awayTokenId` 保留兼容字段名，保存所选协议的交易资产 ID；新增 `marketVersion` 供持久化后的赛果补查恢复身份。Gamma 资产补查覆盖 `position_ids`，并包含已关闭市场；CLOB 结果不得把 V2 的 ID 换回旧 CTF ID。本次修复不扩展链上 split / merge / redeem 能力。

Gamma 已明确返回资产或版本冲突时，查询以专用错误交给新旧下单预检并阻断发送；不能将其吞成普通“未查到”。补查的网络错误也不能清除已取得的冲突证据。

采集器迁移测试的旧源码哈希仅在 `CHANGMEN_HISTORICAL_AUDIT=1` 时显式核对，原基线不修改；日常仍执行业务回归、严格类型、兼容导出和启动测试，遵循仓库的历史审计与业务验证分离规则。

## 撤单确认

[changmen 扩展] 按 [PM 撤单接口](https://docs.polymarket.com/trading/manage-orders) 和 [用户实时事件](https://docs.polymarket.com/trading/realtime-order-updates) 区分余量撤销与成交结算：HTTP `canceled` 包含原单 ID，或当前原账号的用户 WS 返回 `CANCELLATION` / `CANCELED`，即可确认余量撤销，结束按钮的“取消中”。HTTP 200、普通成交事件或 trade `FAILED` 本身不能证明撤单成功。无额外固定秒数期限，传输失败只标记“取消结果待确认”，不自动重发。

撤单前安装账号隔离的事件观察器；已有明确撤单缓存时不再发送 DELETE。确认之后异步发起新一轮原单核对，不复用撤单前的查询，也不接受其迟到结果覆盖新事实。确认余量撤销时保留已知成交，完整成交量、费用与终态仍由原单和成交明细核实；核对期间显示“余量已取消，成交核对中”。新单与旧 GTC 记录使用相同规则。

## 验证

回归覆盖：新记录不含双腿字段；旧索引读取隔离；跨版本和多标签哈希防重；持久化授权；刷新只查原单；部分成交撤余量；未知费用；FAILED 修订；离线保存重试；会话与账号变更；只读预览和新订单展示；公共订单表写入；旧 FOK DTO 的财务字段保持。

所有下单、查询与撤单验证均为离线模拟，不发送真实订单。完整验收使用 `npm run check:change`，覆盖前后端回归、边界检查及含类型检查的前端生产构建。

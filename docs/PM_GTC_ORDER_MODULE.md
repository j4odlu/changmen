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

`submitGtcOrder(account, prepared, context?, onReceipt?)` 只维护一张 PM 原单。可选 context 仅包含关联 linkId 和展示用的 match、bet、item，不要求赛事 ID、盘口行 ID、另一腿或业务激活标记。订单快照直接来自单笔记录。

业务关联属于调用方；GTC/FOK 类型不决定业务来源。一张原单可以包含多笔成交明细，累计结果仍更新同一张订单。日志观察异常不能把已经记录的回执改为未知，也不能触发重发。

## 本地格式及旧客户端

沿用 `changmen_gtc_client_v1`、数据库版本 1 以及 `records`、`results`、`meta` 三个 store，不升级或清空用户数据库。

旧记录 envelope 为 `{key, owner, hashKey, row: GtcExecution}`；新记录为 `{key, hashKey, order: GtcOrderRecord}`，key 使用明确的 `order-v2` 命名空间。新记录的 owner 在 order 内部，旧客户端通过顶层 owner 索引读取时不会误读新格式。新读取通过 owner 的 key 前缀范围取得自己的单笔记录。

两个格式共用原 `hash` 唯一索引，继续按 owner、账号和签单哈希防止重复创建；旧客户端和新客户端也不能为同一签单各发一次。新记录同时保留持久化的一次发送许可和页面发送者身份；刷新、并发标签页或查询失败不会重新取得发送资格。

旧记录不批量重写。旧公共创建入口已移除，旧命令接口拒绝新的发送授权。测试中的旧写入器位于 `src/test/legacyGtcWriter.ts`，仅模拟旧版客户端验证存储兼容，运行时代码不使用它。

## 公共订单及财务

本地记录维护提交和挂单状态，不是另一套财务订单表。已确认成交结果仍通过现有同步协议更新公共 RDS `orders`，以原 orderId 和账号定位。同一原单的部分成交或 FAILED 修订更新原行，不新增一条业务订单。

新写入的 GTC 买单附带 `pmOrderType: GTC`，接口展示为可选 `PmOrderType`；缺省的现有 FOK 行保持原字段和识别方式。原 `pmGtcExecutionId` 等身份字段保留为线协议和历史数据的字段名，不再表示新订单依赖双腿执行结构。

金额、费用舍入和汇率沿用原 PM 财务助手；普通 FOK 下单、补单、自动卖出、配置及订单汇总实现不修改。旧 GTC 的订单标识继续保护原单，不能让普通自动卖出或普通同步接管其未确认结果。

## 验证

回归覆盖：新记录不含双腿字段；旧索引读取隔离；跨版本和多标签哈希防重；持久化授权；刷新只查原单；部分成交撤余量；未知费用；FAILED 修订；离线保存重试；会话与账号变更；只读预览和新订单展示；公共订单表写入；旧 FOK DTO 的财务字段保持。

所有下单、查询与撤单验证均为离线模拟，不发送真实订单。完整验收使用 `npm run check:change`，覆盖前后端回归、边界检查及含类型检查的前端生产构建。

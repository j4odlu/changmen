# 指定订单复用补单上下沿：源码与设计审计

[changmen 扩展] 2026-10-30。审计对象：[指定订单接入方案](../ORDER_EXIT_MAKEUP_BAND_PLAN.md)。状态：文档审计完成，交易功能未实施，未进行实盘交易或执行回归。

## 1. 结论与范围

“把上下沿策略应用到指定订单”可作为局部接入实现。现有计算、候选、预检、下注与确认链路可以复用，不需要先建设通用退出引擎。需要补的是订单到队列的转换、来源/归属和重复管理约束。

本轮用户明确收窄范围后，方案已移除通用现金流模型、卖出/买入自动比选、专用 RDS 计划表、常驻执行和复杂新状态机。PM 预挂止盈卖单保留为原需求中的配套工作，单独注明缺口，不把它误算为已有 band 的能力。

审计基线为本机 `master` 工作区，HEAD `96d5fd8406475a9bd202cae46200705ad800576b`。工作区已有其他未提交改动；本报告描述读取时的源码，不把 HEAD 哈希等同于整个工作区或生产版本。此次仅修改方案、报告和文档索引，不改业务代码，也未提交或部署。

## 2. 直接源码证据

| 编号 | 源码及符号 | 核实事实 |
| --- | --- | --- |
| E01 | [makeupOddsBand.ts](../../client/web/src/extensions/arbBet/makeupOddsBand.ts)：`calcMakeupPlanProfitRate`、`filterMakeupOddsBandCandidates` | 两种模式；利润率分母为两腿总投入；严格越界；最优在带内不退到差价；数据不足返回 null |
| E02 | [makeUpCandidates.ts](../../client/web/src/stores/betting/makeUpCandidates.ts)：`selectMakeUpCandidates` | `useBand = enabled && !isCreateOrder`；候选来自 `bet.items`；null 会回退原 makeProfit |
| E03 | [makeUpPrecheck.ts](../../client/web/src/stores/betting/makeUpPrecheck.ts)：`passesMakeUpPrecheck` | 预检后将 checked 金额转换为 Plan CNY，并按更新赔率复核利润率 |
| E04 | [loseOrderExecution.ts](../../client/web/src/stores/betting/loseOrderExecution.ts)：`runLoseOrderExecution` | 开关门控、队列实例校验、pending 不再 POST；离盘/失败后可能调度套利失败卖出 |
| E05 | [makeUpAccepted.ts](../../client/web/src/stores/betting/makeUpAccepted.ts)：`completeAcceptedMakeUpLeg` | 原回执持久化及普通/PM/PF 确认分流；不能把受理视为成交 |
| E06 | [loseOrderStore.ts](../../client/web/src/stores/loseOrderStore.ts)：`restoreOrdersFromSession`、`createOrder`、`cancelMakeupManually`、`removeOrders` | Map 按 betId，入队直接 set；使用 sessionStorage；取消及批量清理也存在自动卖出分支 |
| E07 | [LoseOrder](../../client/packages/client-core/src/models/loseOrder.ts)：构造、`getBetMoney`、`toJSON` | 金额为 `round(已成金额×已成赔率/对侧赔率)`；新增来源与原单关联要贯穿序列化 |
| E08 | [OrderRow](../../client/web/src/types/order.ts) 与 [盘口查找](../../client/web/src/stores/betting/loseOrderLookup.ts) | 订单 DTO 不含完整 matchId/betId/target；消费方依赖精确 matchId/betId 找回当前盘口 |
| E09 | [linkDisplay.ts](../../client/web/src/shared/linkDisplay.ts)：`isUnboundPlaceholderLink` | 未绑单包括 hash、0 及时间占位；不能直接视为新的最终绑定 |
| E10 | [PM 提交日志](../../client/packages/venue-browser/polymarket/submission/recovery/pmSubmitJournal.ts)：`guardedPmSubmit` | localStorage 保存提交未知状态、Web Locks 跨标签页互斥；scope/side/token 隔离，不是所有场馆或整个补单队列的管理锁 |
| E11 | [PM 手动卖出](../../client/web/src/stores/account/pmManualSell.ts) 与 [adapter](../../client/packages/venue-browser/polymarket/submission/pmManualSell.ts) | 已有 FOK 卖出、原单恢复与保存；仍需与指定订单任务协调，避免原仓卖出后继续反向下注 |
| E12 | [GTC adapter](../../client/packages/venue-browser/polymarket/gtc/index.ts)：`buildPreparedGtcBuy`、`gtcTradeFills`、`readGtcFacts` | 当前此链路签单及方向核对为 BUY；不能声称已支持本需求的 GTC SELL |
| E13 | [retryFailedLeg.ts](../../client/web/src/stores/betting/autoBet/retryFailedLeg.ts) | 即时重试也使用 band，新增接入不应改变旧调用方 |

## 3. 审计发现与方案处置

以下优先级表示未来实施若忽略该项的影响，不表示现网已有对应缺陷。标记“已写入”只表示方案处理了问题，代码仍待实施。

| 编号 | 影响 | 发现 | 已写入的最小处置 |
| --- | --- | --- | --- |
| F01 | 范围 | 初稿把局部复用扩大为完整仓位项目 | 按用户澄清重写为原订单转换后进入现有链路；无新收益引擎/RDS/后台服务 |
| F02 | P1 | E08：订单显示字段不足以唯一恢复补单上下文 | 先通过可靠平台 ID/已有交易关联定位；无法定位的订单不可启用，不按文案猜测 |
| F03 | P1 | E02：按原手动入口创建会跳过 band；未知输入还可能回退 makeProfit | 新增指定订单来源，使用上下沿任务语义；新入口未知则暂停，旧手动与兼容回退不变 |
| F04 | P1 | E06/E07：同 betId 覆盖、原单来源和 owner 未作为该新功能的恢复契约 | 最小版一盘口一任务，统一入队冲突检查；补齐原单/来源/owner 的构造、保存、恢复，不扩建新存储 |
| F05 | P1 | E04/E06：直接套现有任务，取消或离盘可能额外自动卖掉原仓位 | 对指定订单来源分流，覆盖消费、手动取消与批量清理；不改变原自动套利任务行为 |
| F06 | P1 | E07/E11：已部分卖出、原 BUY 仍挂单或成本不完整时，原金额会过度对冲 | 首期明确限制、原单变化校验、与手动卖互斥；不能验证成本及支付时暂停 |
| F07 | P1 | E09：原未绑 Link 可能只是占位 | 沿用现有绑定协议关联原单和新腿；任务跟踪原单身份，不能靠按钮继续显示来维持任务 |
| F08 | P1 | E10/E11/E12：PM 有提交保护但缺本需求 GTC SELL 及止盈/补单协调 | 复用已有保护；SELL 单独验收；补单前撤止盈并查明成交，未决不重发 |
| F09 | P2 | E01：-9.09% 总投入收益率与 -25% 原本金收益率都可能指同一亏损 | 本期只做反向对冲候选，沿用原两腿分母及标签，不引入新分母或自动迁移参数 |
| F10 | P2 | E04/E06：现有队列依赖运行页面、当前合场盘口和补单开关 | UI 明示运行条件；隐藏入口不删除任务；离盘显示原因，不承诺后台持续止损 |

F04 的“一盘口一任务”和 F06 的“完整原单优先”是最小版本建议，不是用户已经确认的永久产品限制。若要求全部历史订单、同盘口多笔或部分平仓均可同时管理，须补相应局部适配及回归，不能在宣传范围中省略限制。

## 4. 经济等价核对

无费用示例：原单 40、返还 100；反向下注 70、返还 100。两侧净收益均为 `100-40-70=-10`，现有总体利润率为 `-10/110≈-9.09%`。以 0.30 卖出原 100 份 PM 资产也损失 10，但会显示原本金收益率 -25%；两者不能直接混排百分比。

该示例只证明资金等式，未证明任意跨平台盘口互补、实际深度或成交费用。现有公式本身不自动取得所有费用/盘口证据，新入口必须校验可转换输入。等量 PM Yes/No 可合并是官方能力，不能推导本项目已接入自动合并。[官方持仓说明](https://docs.polymarket.com/concepts/positions-tokens)

## 5. 验证与限制

- 已按 E01—E13 检查直接调用链与数据结构；方案第 7 节列出实施回归，不把检查源码当作这些回归已经通过。
- 核对金额示例、上下沿严格边界、反向金额及收益率分母。
- 内部链接核对通过：两份新文档共 26 个本地链接均存在，代码围栏闭合；金额示例核对通过。
- `git diff --check` 定向检查通过，并对本轮四个文档做文本空白核对；没有空白错误。两个既有索引的 Git LF/CRLF 提示不是检查失败，原有未提交内容继续保留。
- 使用仓库 `changePlan` 对明确的四个文档文件判定，结果为 `tier=docs`、`checks=[]`、`deployment=noop`，不需要代码回归。
- 工作区另有用户既存源码改动，直接运行无参数 `check:change` 会混入这些改动；本次不以全工作区结果替代本轮文档验证，也不暂存、清理或改写它们。
- 未调用真实下单/撤单、未读取账号凭证、未改数据库，未运行代码构建或业务测试；纯文档按 AGENTS.md 无需代码回归。

结论：简化接入方案可继续实施，核心复用判断成立；F02—F08 为需要落实的局部接入事项。PM 止盈挂单另有 SELL 与撤单协调工作，文档完成不代表交易功能已完成。

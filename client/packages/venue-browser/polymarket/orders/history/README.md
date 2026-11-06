# PM 订单同步更新

这里负责用官方成交和市场数据更新同一笔订单的已有信息。订单按 ID 对齐，保留系统中的绑定、成本和卖出进度；正式存储仍为 RDS。

| 文件 | 职责 |
|---|---|
| `orders.ts` | 保留现有对外入口；读取成交和市场数据、识别来源、消费缓存、执行同步流程及调用快照计算 |
| `orderTradeTypes.ts` | 官方成交与 maker 腿的快照类型 |
| `orderTradeAmounts.ts` | 成交份额/金额、POST 微单位转换与原有四位小数取整 |
| `orderTradeProcessing.ts` | 成交确认状态筛选、maker 归属、分笔展开、按订单汇总、加权均价和交易哈希收集 |
| `orderTradeMapping.ts` | 单笔已汇总成交转换为 USDC 订单快照；买单调用原结算规则，卖单只记录回款，不推断买入成本与利润 |
| `../confirmation/tradeLookup.ts` / `fillResolution.ts` | 成交证据查询、POST 金额优先解析及 delayed 卖出金额重试；与历史同步调度分开，详见确认目录 README |
| `../facts/tradeReader.ts` | 同步与确认共用的五页成交读取；严格模式保留上游错误 |
| `../facts/orderDisplayCurrency.ts` | 原有展示/保存阶段币种转换；POST 合成单也可直接引用，无需加载同步入口 |
| `orderMarketSettlement.ts` | 根据传入市场快照判断赛果，计算持有订单的普通胜负或 50/50 兑付 |
| `orderSellAttribution.ts` | 官网卖出份额与买单的归因、剩余成本、已实现利润；站内订单沿用已保存的归因 |
| `orderSyncUpdate.ts` | 用传入的成交/市场快照更新已保存订单，保护分组、费用、部分卖出、全部卖出和最终结算凭据 |
| `orderMarketReader.ts` | 官方市场数据读取：沿用 Gamma 查询、CLOB 身份核验与覆盖、最终兑付查询；网络和标签发布由入口注入 |
| `storedMarketRefresh.ts` | 既有历史盘口后台读取与缓存调度 |
| `pmOrderSync.ts` | 既有成交查询时间窗口与同步标记 |
| `pmStoredOrders.ts` | Web 层注入的 RDS 订单加载器 |
| `pmOrderPrice.ts` | 既有官方订单限价补充 |

计算模块不导入 `orders.ts`、网络 transport、账号鉴权、标签缓存或 `localStorage`。`orderSyncUpdate.ts` 接收外层已读取的盘口标签和市场对象，不自行寻找外部数据。

地址格式函数独立为 `polymarket/ethAddress.ts`，鉴权模块继续导出同一函数；成交处理不再因地址校验而加载凭证解析和签名实现。maker 归属仍优先核对合法地址，没有合法地址时才核对 API owner；调用方未提供地址集合时保留原行为。BUY 汇总保留原始名义金额，SELL 仍逐腿取四位小数后汇总，不能在拆分时擅自统一精度阶段。

`orderTradeProcessing.ts` 仅判断传入的成交状态，不负责等待成交、重试或撤单。POST 优先、成交查询及 delayed 卖单金额重试已移到 `confirmation`。金额补查按原单关联成交累计并复核总份额；缺实际金额时手动卖出保持 pending，不再以限价或买价估算入账。FOK/GTC 的证据状态机、撤单、保存接口和余额流程保持独立，详见确认目录 README。

调用顺序继续是：读取官方数据和已有订单 → 更新同一笔订单 → 官网卖出归因 → 补充费用与订单限价 → 按原流程转换展示币种。最终保存仍走原账号订单同步流程。

金额遵循以下阶段契约；字段不能因为同为 number 就混用。

| 字段 | 计算阶段 | 加载/保存及显示阶段 | 含义 |
|---|---|---|---|
| `betMoney` / `BetMoney` | USDC | CNY | 原始买入含费总成本；部分卖出后不改成剩余成本 |
| `money` / `Money` | USDC | CNY | 实际累计盈亏；报表读取此字段，卖单不重复计入买单利润 |
| `reward` | USDC | CNY | 回款字段；DTO 先按原赔率重建名义值，不能直接当最终兑付。已核验最终凭据时按剩余份额 × 兑付价准备，未核验时只归一化名义值的币种 |
| `pmStakeUsdc` | USDC | USDC | 剩余持仓的含费成本；已全部卖出为零 |
| `pmFeeUsdc` | USDC | USDC | 已计入成本的费用，不应再次从盈亏扣除 |
| `pmRealizedPnlUsdc` | USDC | USDC | 已实现卖出盈亏，不包含早期价格判定产生的剩余仓纸面盈亏 |
| `pmSellProceeds` | USDC | USDC | 卖出现金回款，与卖出利润不同 |
| `pmShares` / `pmAttributedSellShares` | 份 | 份 | 官方累计成交份额 / 已归因卖出份额，不按汇率缩放 |
| `pmFillPrice` | USDC/份 | USDC/份 | 官方成交价，手续费不摊入此字段 |
| `pmSettlement` | 绑定身份的凭据 | 原样保存 | condition、持有资产、0/0.5/1 兑付价和官方来源必须一致 |
| `pmMatchResult` | 市场判定 | 原样保存/DTO 大小写映射 | 与财务输赢分开；已有价格提前判定不等于已核验最终兑付 |

2026-11-06 的字段审计修正了 `reward` 在已保存订单加载后的重复换汇和已核验结算沿用整仓名义回款问题：在 `orderSyncUpdate.ts` 将名义值还原为 USDC；已有有效最终凭据的买单，按剩余份额 × 最终兑付价计算。成本、`money`、卖出归因和报表计算不随此修正改变。`orderFieldContract.test.ts` 覆盖真实 DTO 加载函数、计算、显示与重复同步；旧问题在修复前有 8 条失败证据。

`orderMarketReader.ts` 不持有账号、订单金额或缓存；每轮只返回本轮取得的市场事实，历史失败时保留旧缓存的职责继续属于 `storedMarketRefresh.ts`。通过注入现有 transport 和标签发布函数，维持原查询顺序、二十条分组、keyset 失败回退、CLOB 优先及最终凭据核验；没有引入另一套重试或连接流程。

现有对外函数和类型导出保留在 `orders.ts`，调用方不需要迁移。新文件没有增加旧版本字段兜底或另一套结算公式。

验证包括 `adapter/polymarket/tests/orders/orderSyncUpdate.test.ts` 的冻结输入与外部状态访问检查、`orderSyncUpdateBoundary.test.ts` 的依赖边界、`orderMarketReader.test.ts` 的查询与失败处理、字段契约测试、成交处理与映射的直接测试，以及既有订单/结算/手续费回归。提取出来的源文件（包括纯地址 helper）继续受电竞冻结闸门保护；原冻结清单没有修改。

## 2026-11-06 买入全成本

普通买单的正式总成本直接取准确归属的全部 `TRADE BUY` activity 的 `usdc_size` 合计，不再追加平台费或 builder fee。`price` 和费用分项用于展示、核对，不用于再次拼出总成本。金额保留六位原币精度，展示/保存时仍只换汇一次。

成本同步必须具有原单的成交交易哈希，并核对钱包、资产和成交份额；不再依靠相近时间/份额写入成本。同钱包、同资产、同交易中存在多张订单而无法区分时保留已有值，不按比例猜分。缺页、失败成交、尚未索引或缺少原单引用也保留已有金额，后续同步再核对。已有卖出进度的原始成本和剩余敞口不由买入 activity 全额覆盖。

POST 成交后、activity 尚未到达时只保留已有成交本金，不读取当前费率生成最终费用。GTC 同样读取实际 activity，每段成交保存官方 `cost`，总成本直接累计；没有回执时费用保持待核实，不以 Maker 身份推断零费用。已核对的金额不会被随后缺少 activity 的快照降回本金。卖单回款口径不随本次买入成本改动改变。

针对性回归位于 `activityBuyCost.test.ts`、`gtc/activityCost.test.ts`、`order/activity_buy_cost.test.mjs` 及 GTC 财务测试。真实样本回放包含 324 组普通买入；另 19 组 Protocol V2 组合盘属于 changmen 未支持业务，不能用来宣称普通 Protocol V2 买单已取得真实成交覆盖。

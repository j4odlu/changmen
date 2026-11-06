# PM 成交确认

这里回答原订单是否存在成交证据、POST/成交快照记录了多少金额；市场最终赛果和兑付由 `orders/history/orderMarketSettlement.ts` 等模块处理。

| 文件 | 职责 |
|---|---|
| `tradeLookup.ts` | 按当前账号、原 orderId、买卖方向及原有状态规则选择成交证据；唯一 BUY taker FAILED 仅在调用方明确开启时暴露 |
| `fillResolution.ts` | 完整 POST 微单位金额优先；缺少完整回执时核对累计成交；delayed SELL 沿用原重试次数和间隔 |
| `orderFillReader.ts` | 按原单的 `associate_trades` 精确补查所有 tradeId，最多四个并发；读取前后复核原单数量及关联 ID，缺失或变化时不返回部分金额 |
| `legOutcome.ts` | 沿用买入腿的结果编排、未知提交恢复、后台 Job、超时策略及供绑定的订单构造 |
| `marketDelay.ts` | 既有市场延迟参数读取与轮询选项 |
| `pmHeartbeat.ts` | 既有心跳管理 |
| `../facts/tradeReader.ts` | 同步和确认共用的成交读取；账号路由和签名仍交给 `pmGetTrades`，沿用五页上限 |
| `../facts/orderDisplayCurrency.ts` | 单独提供原有展示/保存阶段币种转换，不加载历史同步入口 |
| `../facts/orderFillTotals.ts` | 纯快照累计名义金额核对：原单、市场、资产、买卖方向、tradeId/bucket 去重、逐腿金额及总份额；不使用均价反推金额 |
| `../../fok/orderSettlement.ts` / `settlementJob.ts` | 既有 WS/REST 核验、撤单、延迟重试及后台 Job；本批只调整成交查询的依赖入口 |

`tradeLookup` 和 `fillResolution` 已通过 `@changmen/venue-browser/polymarket/orders/confirmation/...` 显式导出。原 `history/orders.ts` 中相同函数和常量继续导出同一实现，调用方接口保持一致；没有另一套版本兜底实现。

FOK 核验、买入腿确认、未知提交恢复和手动卖出直接引用确认模块。POST 合成订单与市场预检直接引用币种和赛果计算模块，不再经历史订单调度入口取得 helper。依赖边界测试递归检查相对路径、PM 包入口及动态 import，拒绝重新触达历史调度、已有订单加载、同步标记和市场后台读取。

严格读取失败或非列表响应继续抛错，不能伪装成“查无成交”；普通订单同步沿用非严格读取失败时的空列表行为。没有增加独立连接、缓存、订单写入、余额刷新或下单重发。

第六轮拆分保留了原有行为；第七轮累计金额修复后遵循以下契约：

- `CONFIRMED` / `MATCHED` / `MINED` / `RETRYING` 的既有状态筛选保持不变；不把这些标签都解释为链上最终确认。
- `tradeLookup` 的证据查询仍返回首个满足条件的快照，供原订单存在性和 FOK 证据判断使用。金额补查改用 `orderFillReader`，按单订单接口的关联 ID 精确补齐，不把账号时间窗的五页列表或第一笔撮合当作全部金额。
- 有效 POST 回执优先且不额外读取成交；POST 与 GET 的单位转换分别沿用原规则。
- delayed SELL 仍只在两次尝试之间等待，成功后立即停止。只有全部关联成交、资产/市场/方向、前后订单快照和总份额核对一致才返回累计金额；缺数据、错误响应、重复冲突、份额不符或查询中订单变化都继续待核实。
- 手动卖出不再用限价、买入价或 0.01 占位估算回款写账，也不把恢复日志中的单笔成交当作整单金额。部分 POST 回款不能和另一份未核实数量拼成完整成交。已有份额但金额未齐时返回 `pending`，沿用既有 closing 与自动续查，不生成盈亏 patch，不解除原卖单锁。
- FOK 的核验耗尽判定及主动撤单规则没有移植到 GTC；GTC 的部分成交、撤单后已成交份额和恢复状态仍由其原模块管理。

官方依据为 [Manage Orders](https://docs.polymarket.com/trading/manage-orders)：单订单提供已成交份额及关联 tradeId，成交查询提供逐腿份额、价格、资产和方向，并支持按 tradeId 查询。**本项目的实现选择**是在金额补查时精确读取关联成交、去重并复核数量；官方字段定义不能被解释为“拿到一笔成交就是整单金额”。

累计结果仍为既有口径的 USDC 成交名义金额，不等于钱包净入账；手续费、成本、汇率和最终市场兑付公式没有改写。有效完整 POST 回执继续直接使用，金额接口原 lookback 参数位置保留，但补查已不依赖时间窗。GTC 的单订单事实与净回款核对流程保持独立。

直接测试包括 `adapter/polymarket/tests/orders/{tradeLookup,fillResolution,orderFillTotals,orderConfirmationBoundary}.test.ts` 和 `submission/pmManualSell.amounts.test.ts`；Web closing 测试验证金额待核实期间不保存、不释放锁、不重发，随后用同一原卖单的完整结果保存。新增源文件继续受冻结保护，原冻结清单与历史证据不修改。

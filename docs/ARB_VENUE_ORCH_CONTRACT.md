# 场馆 ↔ 编排契约（冻结）

与 [ARB_LINK_ID.md](./ARB_LINK_ID.md) 互补：Link 归属编排；**腿终态判定归属场馆**。

## 硬规则

1. **解耦**：拒单 / FOK / delayed 判定只在 `@venue` / `resolveVenueLegOutcome`；编排只消费结果。
2. **有指令必有结果**：编排禁止用「没回」猜场馆状态。
3. **未发指令**：编排自标 `not_attempted`（顺序短路等），场馆无调用。

## 指令 → 回传

| 编排指令 | 场馆必须回传 | 备注 |
|----------|--------------|------|
| `checkBetting` | 有/无 `data` + 错误 | 失败也要回 |
| `betting` | `BetResult`（success/fail；PM/PF 可 `pending`） | 未调用 → `not_attempted` |
| `settleArbLeg` / `resolveLegOutcome` | `VenueLegOutcome`：`filled` \| `unfilled` \| `timeout` + `orders` | 编排不改写判定。**PM 不回 `timeout`** |

## Polymarket 三态（betting → settle）

| POST / BetResult | settle 行为 | 编排消费 |
|------------------|-------------|---------|
| API 失败 / FOK 未受理 | 不进 settle | `api_failed` |
| **fill confirmed**（`matched` + takingAmount>0） | **快路径**：直接 `filled`，不进 delayed poll；拉单 **一次** 供绑单 | 绑单 / 不成补单 |
| `pending` / delayed | settlement job：等满官方 `sd` + 查询滞后后 **filled / unfilled** | 见下表 |

官方 delay（[Order Lifecycle](https://docs.polymarket.com/concepts/order-lifecycle)）：体育盘 `delayed` = 异步 seconds-delay 窗；时长取 CLOB `GET /clob-markets/{condition_id}` 的 **`sd`**（秒）。轮询见 `buildPolymarketDelayedPollOpts(sd)`：先等满 `sd`，再最多 `POLYMARKET_POST_DELAY_GET_LAG_MS`（2s，**[changmen 扩展]** GET 滞后，非官方第二段 delay）。窗内不可撤。窗后：撮合、校验失败 rejected，或 `unmatched` 挂簿。本仓库 FOK：**窗后无成交必须 `unfilled`（可撤则撤）**。官方无 `timeout` 态；poll 内部 timeout 经 `coercePolymarketFokPollOutcome` 收成 `unfilled`，**不得**回传编排 / 进行中订单。官方未规定缺省 `sd`：拉失败 / 无 `condition_id` / 行无 `sd` 时用保守上限 **30s**（`UNKNOWN_SPORTS_SECONDS_DELAY`），禁止默认 1s。Settlement Job 缺失时须复用下单时的 poll，或按 `pmConditionId` 再拉 `sd`。`delayed` / 查不到行（delay 窗内常见 404）须走 FOK grace，窗内不立刻 cancel。

| settle | 含义 | 套利补单 |
|--------|------|----------|
| `filled` | 成交 | 不补 |
| `unfilled` | 确认未成交（FOK 窗后无成交 / cancel） | **可补** |

`[changmen 扩展]` fill confirmed 时编排入口可跳过无意义预拉（见 `resolveVenueLegOutcome`）。
`isVenueLegConfirmedUnfilled` = 仅 `unfilled`。PM 进行中订单：delay 窗内「确认中」；窗后只显示已成交或拒单。编排层 `settleArbLeg` 若仍收到 PM `timeout`，按 `unfilled` 收，`pendingConfirm=false`（与 UI / 补单一致）。

## PredictFun 三态（betting → settle）

**模型**：受理后确认场馆（类 A8 + timeout 第三态），**不是** PM「POST 常已成交」。

官方依据：[Create order](https://dev.predict.fun/create-an-order-32534694e0)、[Get order by hash](https://dev.predict.fun/get-order-by-hash-25326901e0)、[OrderStatus](https://dev.predict.fun/orderstatus-14037508d0)、[OrderStatusFilter](https://dev.predict.fun/orderstatusfilter-14037509d0)、[predictWalletEvents](https://dev.predict.fun/subscription-topics-1915507m0)。

| 阶段 | 官方事实 | changmen 含义 |
|------|----------|----------------|
| 预检 | 限价 + FOK 深度 | 挡必挂单；**不保证成交** |
| **API 下单成功** | `POST /v1/orders` 返回 `orderId`（体无 `status`） | **仅**官网收下挂单；`success=true` + `pending=true`；placeOutcome=`accepted_pending_confirm` |
| 未受理 | 无 `orderId` / 抛错 | `api_failed`（不进 settle） |
| 成交 | `FILLED` / wallet `orderTransactionSuccess` | 唯一可当「成了」；成功计数 / 补单锚腿以 **filled** 为准；买单若 `feeRateBps>0` 且尚无 wallet fee，编排仍报 `timeout`（hold 未齐） |
| 拒单 | `CANCELLED` / `EXPIRED` / `INVALIDATED` | 与 A8 `reject` 同级 → `unfilled`，**可补** |
| 未决 | 仍 `OPEN` / 查不到 | `timeout`，**不补新单**；挂 `pendingVenueOrderId` 续查原单 |

| 官方细节 | 编排含义 |
|----------|----------|
| `GET /v1/orders` filter **仅** `OPEN\|FILLED` | 拒单不能靠列表猜，须 `GET …/{hash}`；套利/jb/手动 settle **必须** `confirmPostAccepted=true` |
| house：`MARKET` + `isFillOrKill` + `isMinAmountOut` | 受理 ≠ 成交；FOK 可能随后 CANCELLED（接受→取消为正规路径） |

| 确认信号 | settlement |
|----------|------------|
| wallet `orderNotAccepted` / `orderCancelled` / `orderExpired` / `orderTransactionFailed` | **unfilled**（可补） |
| wallet `orderTransactionSuccess`（+ REST 校正金额） | **filled** |
| wallet `orderAccepted` / `orderTransactionSubmitted` | 继续等 |
| REST `FILLED` / 拒单终态 / 仍 `OPEN` 到时限 | filled / unfilled / **timeout** |

编排门控（与 PM **同消费面**；命名为「受理后确认」，不再绑 PM）：

- `isPendingConfirmVenueProvider` / `confirmPostAccepted` / `deferPostAcceptSettlement` / `rejectWait=0` 对 PredictFun 生效
- `betGateway`：仅 `!deferPostAcceptSettlement` 时后台 settle（双腿套利防双 settle）
- `markArbSuccessLegs`：**仅 PF** 在仍 `pendingConfirm` 时不记成功（等 filled）；A8/PM 不变
- timeout：**不补新单**；jb / `arbMakeUpFromRejects` 续查原单（`pendingVenueOrderId`）

确认实现：VPS `predictWalletEvents` **优先**；`fetchHousePredictOrderResolved` / `waitForHouseOrderTerminal` / `Pf_GetOrder` REST 兜底。客户端 confirm 轮询前密后疏，总窗对齐服务端 sell 确认量级。勿依赖列表 filter 判拒。

与 A8 / PM 对照：

- **像 A8**：受理 ≠ 成交，必须事后确认
- **不像 A8**：确认靠 hash/`wallet`，不是长 `rejectWait` + 列表首条；多 timeout
- **不像 PM**：无 `matched` fill-confirmed 快路径

## 混合对（PM/PF + 即时馆）

[changmen 扩展] 2026-10-07 首期 PM 预检优化：双腿完成本轮预检与现有 `checkTimeout` 检查后按用户 `betSorting` 提交。`Parallel` 并发，`Serial` 顺序；不为混合对强制并发，不重锁即时馆，也不对 OB/TF 重发探测单。`checkTimeout=0` 仍为关闭超时限制。

PM 预检并行执行 book、Gamma market、CLOB market、必要的 Gamma event 与签名/出口准备。各 guard 来源独立结算，事件查询异常不能掩盖已知封盘。账号比例 9999 的自动仅预检腿使用 `precheckOnly`，不要求钱包或出口准备；手动下单使用 `execute`。

PM 成功预检绑定同一个 BetOption、账号和冻结参数，在第一个异步签名步骤前同步消费；同一结果不能重复发单。`betting` 只做本地一致性核验、本地 OrderBuilder 构单和 POST，不含 Gamma、book、年龄复检或重新定价。已知 tick 变更导致限价非法、钱包失效或参数改变时返回本地失败；不引入新的整轮取消机制。双腿开始提交前汇总可见的本地失败；已提交腿按既有确认及补单语义处理。

vps/official 的公开 GET 连续两次网络错误后进入按 origin 隔离的 30 秒冷却，随后单探针恢复，失败退避最多 120 秒；429/鉴权/业务拒绝不绕路。仅合并同一传输上下文中并发且相同的公开 GET，不缓存跨轮次 guard 放行结果。

VPS 通过 `Pm_PrepareSubmit` 在冷预检校时，之后后台更新。POST `/order` 读取可靠时钟并为准确正文生成新 L2 HMAC，不同步请求 `/time`。客户端与服务端需成套发布；未就绪时失败而不在提交中补查。手动卖出也在其准备阶段调用出口准备。

HTTP 仍只等待 POST ACK（客户端 30 秒、VPS POST 20 秒），撮合按官方 `sd` 等待；delayed、matched 和未知状态的确认逻辑保持原实现。完整方案及验收进度见 [PM_PRECHECK_OPTIMIZATION_PLAN.md](./PM_PRECHECK_OPTIMIZATION_PLAN.md)。

## A8 场馆（OB / RAY / …）

`[A8 可证实]`：`venueRejectWaitBeforePoll(rejectWaitSec)` → 拉单 → `orders[0].status === "reject"` 视为 unfilled。  
本契约**不改**该语义。

## 相关代码

- 编排入口：`client/web/src/domain/betting/resolveVenueLegOutcome.ts`
- PM outcome：`packages/venue-adapter/polymarket/legOutcome.ts`
- PF outcome：`packages/venue-adapter/predictfun/legOutcome.ts`
- fill 判定：`isPolymarketBetResultFillConfirmed`（`orderStatus.ts`）
- 门控：`isPendingConfirmVenueProvider`（`packages/shared/account_multiply.ts`）
- A8 outcome：`packages/venue-adapter/adaptation/a8LegOutcome.ts`
- 套利 settle：`settleBothArbLegs` → `settleArbLeg`
- place 腿态：`ArbLegPlaceOutcome`（`accepted_pending_confirm` = PF 挂单待确认）

# 套利 LinkID 语义（冻结）

对齐 A8 `index0706.js` 的 `IPe` / `vx` / `Ly`；changmen 扩展单独标注。  
**手动补单挂靠已有 Link：暂不做。**

## 硬规则

1. **一尝试一 `linkId`**：`GetOrderOptions` 成功后立刻铸造（A8 `new IPe` → `linkId = Date.now()`）。
2. **双腿套利**：正毫秒时间戳（`≥ 1e12`）。同 ms 碰撞时进程内可 `+1`。
3. **自动补单 / 换腿重试**：必须继承同一 `linkId`，禁止换号。
4. **`Order.Link` 是唯一分组键**：侧栏 / 管理端 `groupBy(Link)`（A8 同）。
5. **Bind 是确认关联，不是创造关联**：关联在选腿时已存在；`SaveOrderBind` 把场馆 `OrderID` 写成该 `linkId`。
6. **手动补单**：`linkId = 0`（A8 同），不进套利组。

## A8 对象 ↔ changmen

| A8 | changmen |
|----|----------|
| `IPe.linkId` | `ArbBetReady.linkId`（`createArbLinkId`） |
| `vx(LinkID, Provider, OrderID)` | `bindArbLegOrder` → `Client_SaveOrderBind` |
| `Ly.linkId`（自动补单） | `LoseOrder.linkId` |
| `groupBy(Order.Link)` | `groupOrdersByLink` |

## 类型（旁路，不污染数值）

| kind | `linkId` 形态 | 来源 |
|------|---------------|------|
| `arb` | 正 `Date.now()` | A8 可证实 |
| `single9999` | 负 `-Date.now()` | changmen 扩展 |
| `valueBet` | `-(7e15 + now)` | changmen 扩展 |
| `manual` | `0` | A8 可证实 |

新类型用旁路 `kind` / 展示标签，**禁止**再发明新的魔法数值区间。

## 时序

### [changmen 扩展] 订单的合场赛事与地图身份

新下单从选中的合场对象固定 `clientMarket` 快照：`matchId`、`betId`、`round`、`game`、`matchTitle`、`betName`，以及可选的 `startAt`、`marketCode`、`line`。`round=0` 为全场，正数为地图序号，`-1` 为特殊盘口。平台原生赛事、市场和选项身份仍属于原始订单；例如策略地图3可以对应 PM 全场市场，不能互相改写。

快照经首次保存或精确绑单写入 RDS `orders.raw.clientMarket`；查询以可选 `ClientMarket` 返回。使用现有 JSONB，无新表、列迁移或历史批量回填。Link 的铸造、分组、计数、补单与财务规则不变，这些字段仅用于身份追溯，不作为下单许可或财务真相。

自动补单和换腿继承原策略快照，补单队列、延迟确认和 RAY 关联上下文恢复时保留。PM 原生 GTC 可选携带同一快照，不要求有合场上下文；已确认结果保存到公共订单时继续传递。手动 FOK 仅在已知精确场馆原单 ID 时附带保存，不为记录身份另铸 Link。

平台刷新省略这些字段时保留已落库快照，普通订单 upsert 在 SQL 写入时也保护它，避免并发刷新擦除刚完成的绑单。带快照的绑单核对用户/账号归属及字段格式，拒绝覆盖已记录的其他赛事、盘口或地图。它保存的是下单时客户端选择的身份，不依赖当前赛事列表仍存在；历史订单缺少明确证据时保持未知，不从队名或盘口文字推断补全。

```
GetOrderOptions → mint linkId
  → check → place → settle(updateOrders)
  → [尽量] SaveOrder 直写最终 linkId（缩短占位）
  → SaveOrderBind 确认（幂等；失败可感知/可重试）
  → 自动补单继承 linkId → 补单成交后再 Bind
```

## 编排层两腿结果契约（冻结）

**场馆层与编排层解耦**：拒单等待、拉单、`status===reject`、PM FOK 合成拒单等仍走 A8 / venue-adapter（`settleArbLeg` / `resolveVenueLegOutcome`）。编排层只消费「每腿是否 API 成功 / 场馆是否 unfilled」，不改写场馆判定。

预检通过并开始执行套利后：

1. **编排层** = `finalizeArbBet`（settle → makeup → mark → UI → notify）。
2. **每一侧**必须有明确 place 结果回传，哪怕未真正 POST。
3. **禁止**在 `placeArbLegs` 因某腿失败 `return null` 跳过 finalize。
4. **下不下单**仍由 place 策略决定（顺序模式 A 失败可不打 B）；未打的一侧标 `not_attempted`。

| place 腿态 | 含义 |
|------------|------|
| `filled_pending_settle` | API 成功，交场馆层 settle |
| `api_failed` | 已 POST（或等价）但 API 失败 |
| `not_attempted` | 本侧未发起下单（顺序短路 / 9999 无账号侧） |

预检失败：可不进 place/finalize。场馆 settle 后的终态（filled / rejected / pending_confirm）仍由场馆层产出，编排层据此补单/绑单/UI。

场馆指令→结果表、PM fill confirmed 快路径、A8 拒单等待不变：见 [ARB_VENUE_ORCH_CONTRACT.md](./ARB_VENUE_ORCH_CONTRACT.md)。

## 实现状态

| 项 | 状态 |
|----|------|
| 语义冻结本文档 | ✅ |
| Bind 失败可感知（进行中订单 + trace） | ✅ |
| Bind 当场重试（3 次） | ✅ |
| Bind 失败补绑队列（主循环每轮） | ✅ |
| SaveOrder 直写最终 `linkId`（缩短占位） | ✅ |
| 用户 Telegram `bettingMessage` 带完整 LinkID | ✅ |
| `auto-rebind-arb-orders` 跳过已直写/已绑 arb link | ✅ |
| 侧栏/管理端统一 kind 徽标（套利/套利·单腿/单边/正EV/未绑单） | ✅ |
| 进行中订单绑单成功追加「已绑单」 | ✅ |
| 未绑单占位短暂态（虚线框 + 标签） | ✅ |
| 预检通过后两腿结果必达编排层（place 不 abort） | ✅ |
| 场馆 settle 回传契约 + PM fill confirmed 快路径 | ✅ |
| 手动补单挂靠已有 Link | ❌ 暂不做 |
| RDS `arb_sessions` 表 | ❌ 暂不做 |

### 相关代码

- 铸 ID：`client/web/src/domain/betting/singleLegRate.ts` → `createArbLinkId`
- 铸点：`prepareArbAttempt.ts`
- 拉单带 Link：`venueOrders.syncVenueOrders({ pendingBindLinkId })`
- 后端优先落库：`server/backend/core/account/order_store.js` → `resolveSaveOrderLink`
- 绑单重试：`arbOrderBind.bindArbLegOrder`
- 补绑队列：`pendingOrderBind.ts`（`runArbBetRound` 每轮 `processPendingOrderBinds`）
- 运维补绑：`server/backend/scripts/auto-rebind-arb-orders.mjs`
- 展示：`shared/linkDisplay.ts`（侧栏 `OrderList` / 管理端 / 进行中订单）
- 编排两腿契约：`phases/types.ts`（`ArbLegPlaceOutcome`）→ `placeArbLegs` → `finalizeArbBet`
- 场馆 settle：`arbLegSettle` / `@venue` A8·PM outcome（契约见 `ARB_VENUE_ORCH_CONTRACT.md`）

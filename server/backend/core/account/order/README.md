# account/order

`order_store.js` 的落库合并拆分目录。对外符号仍从 `order_store.js` re-export。

## 入口

| 符号 | 作用 |
|------|------|
| `saveOrder` | 写库循环：prefetch → link → **mergeOrderLogicalSave** → upsert |
| `mergeOrderLogicalSave` | 三平行分发（旧名 `mergePolymarketLogicalSave`，已废弃不留别名） |

## 文件

| 文件 | 职责 |
|------|------|
| `dto.js` | `rowToOrder` / `scrubClientOrder` / `toClientOrder` / holdShares |
| `date_key.js` | 日键 |
| `kinds.js` | 买/卖判定、卖单不计笔数 |
| `link.js` | 卖单跟买单 Link、归账日并入、`findOrderRowById`（大小写不敏感） |
| `save_pm.js` | `mergePolymarketProviderSave` — 仅 Polymarket |
| `save_pf.js` | `mergePredictFunLogicalSave` — 仅 PredictFun |
| `save_non_pm.js` | 场馆/其它 + 非 PM 共用 raw 保留 |
| `position_events.js` | Phase 1 仓位 `positionEvents.sells` 缺省保留 + 按 id 幂等 |

## 约定

- **PredictFun**：浏览器不经 `Client_SaveOrder`；权威写经 `upsertPfServerOrder` → `saveOrder(..., "PredictFun")`。
- **本单 orderId**：读 prev 与 prefetch 均大小写不敏感；若命中已有行，upsert 主键用**库内** `order_id`，避免 PG 大小写敏感冲突键插出重复行。
- **仓位卖出事件**：写在买单 `raw.positionEvents.sells[]`；`mergeOrderLogicalSave` 缺省保留、按 sell id 幂等；卖单行剥掉该字段。Phase 1 读路径优先事件；仍双写独立卖单行，盈亏不以事件重算。
- 勿与合场 `matchMerge` 混淆：这里是订单字段合并，不是多馆比赛合成。

## Polymarket 最终 50/50（用户确认，2026-11-05）

- 以官方 Data API `/v2/resolutions` 同一 condition 的 `resolved` 和 `payouts=[500000,500000]` 确认，每份兑付 0.50；盘口报价 0.5 本身不证明结算。CTF 与 Protocol V2 使用各自市场资产身份校验。
- `pmMatchResult=equal_split` 独立记录官方赛果；财务 `status` 按累计实际盈亏：盈利 `Win`、亏损 `Lose`、零盈亏 `Return`（退）。展示“50/50 已结算”。
- 未卖出盈亏为份数×0.50−含费成本；部分卖出为已实现卖出盈亏＋剩余份数×0.50−剩余含费成本；已卖光保持原卖出盈亏。手续费不重复扣减。
- 官方最终 50/50 覆盖先前价格提前判定；旧客户端快照不得回滚最终赛果和盈亏。组内统一币种加总各腿实际盈亏，50/50 财务输赢不计入单赢家赛果胜率。

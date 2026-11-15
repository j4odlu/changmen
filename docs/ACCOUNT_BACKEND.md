# changmen 投注账号后端

A8 仅有 `index.js` 可见，**A8 服务端为黑盒**。changmen 后端为自有设计，只需满足 **Client_* 线协议**（与 bundle 里的调用/响应一致）。

## 三层别混

| 层 | 可知内容 |
|----|----------|
| **A8 前端** `[A8 可证实]` | `Client_GetData` / `SaveData` key=`ACCOUNT` 传递 **JSON 数组**；元素含 `accountId`、provider、gateway、token 等 |
| **A8 服务端** | 不可见 |
| **changmen 服务端** `[changmen 实现]` | 见下「存储」 |

## ACCOUNT 兼容约束与维护

- [A8 可证实] 前端 `stores/account` 的加载、`persistAccounts` 及余额刷新后保存的时序与 API 调用须与 bundle 一致，不增加空列表 skip 或 admin 预览 skip save。
- [changmen 扩展] 管理端用户工作区预览使用 `adminWorkspacePreview`。后端须拒绝空列表覆盖已有账号及非本人 `playerId` 保存，不能依赖前端跳过保存来保证安全。
- 后端模型调整按「兼容 → 迁移 → 内部重构」推进，保持 `Client_*` 线协议、对外 bigint `accountId` 及订单 `player_id` 关联。
- 手动改库后按本文运维说明刷新缓存；不得跨 profile 复制凭证。旧账号巡检入口已归 `rds/maintenance/legacy/`，仅供历史维护取证。

## 存储（players 唯一真相）

```text
players
  id                    ← wire accountId / CreateTagPlatform playerId
  owner_user_id         ← profiles.id，每用户隔离
  platform_id / platform_name / player_name
  provider              ← 场馆 adapter 键
  venue_member_id       ← [changmen 扩展] 场馆会员 ID（与 account_data.venueMemberId 同步）
  credit / total_balance
  account_data jsonb    ← 凭证 gateway/token、限额 rateConfig、game 等其余线协议字段

profiles.accounts jsonb ← 已弃写；仅保留历史迁移背景，当前运行时不再读写，部署不做 backfill
```

对外 `Client_GetData(ACCOUNT)` / `Client_SaveData(ACCOUNT)` 仍返回/接收完整 JSON 数组；后端在读写时与 `players` 行互转（`rds/player_account_record.js`）。

## 模型关系

```text
users / profiles
  └── betting_config / preferences（与账号无关）

players (每用户隔离，唯一真相)
  owner_user_id   uuid NOT NULL（活跃行）→ profiles.id
  account_data    凭证 + 投注配置
  UNIQUE (owner_user_id, platform_id, player_name) WHERE deleted_at IS NULL
  UNIQUE (owner_user_id, provider, venue_member_id) WHERE deleted_at IS NULL AND venue_member_id <> '' AND provider <> ''
  UNIQUE (venue_account_key) WHERE venue_account_key <> ''
    ← 含软删：A 删号后他人不可抢加；仅 A 通过「添加账号」复活同一 playerId

orders / money_logs
  user_id + player_id
```

## Client_* 合约（前端 index.js 不变）

| API | changmen 后端职责 |
|-----|-------------------|
| `Client_CreateTagPlatform` | 当前用户下创建/复用/复活（本人软删）player，返回 `{ playerId, ... }`；他人占用（含已删）拒绝 |
| `Client_GetData` / `SaveData` key=`ACCOUNT` | 读/写 **players**（组装/拆解线协议 JSON）；禁止空列表覆盖 |
| `Client_UpdateBalance` | 仅本人 player |
| `Client_DeletePlayer` | 软删 player + 从内存账号列表移除 |
| `Client_SaveOrder` / `SaveMoneyLog` | 仅本人 player_id |

## 预测市场：仓位（买单）与减仓事件（`[changmen 扩展]`）

仅 **Polymarket / PredictFun**。无 A8 协议字段；落在 `orders.raw` + 前端展示层。

### 词汇（终态 / 迁移中）

| 词 | 含义 |
|----|------|
| **仓位** | 一条 PM/PF **买单** `orders` 行（开仓） |
| **减仓 / 平仓** | 写在该仓位 `raw`：状态、已卖份额、回款、盈亏 + `positionEvents.sells[]` |
| **独立卖单行** | 今日仍双写（影子行，`money` 恒 0）；迁移目标是 **禁止新建并最终删除** |
| 场馆单（OB/RAY 等） | 仍是独立订单，不在仓位模型内 |

官网卖 changmen 仓：**不归因**（仅侧栏手动卖写绑定）。

### 字段（当前双写期）

| | Polymarket | PredictFun |
|--|------------|------------|
| 仓位状态 | `pmSellState`：`open` / `partial` / `closed`（手动减仓）；`settled`（**赛果结算**，不是卖出流水） | `pfSellState`：`open` / `closed`（仅 1:1 全卖）；另有 `closing` |
| 回款真相 | 仓位 `pmSellProceeds`（USDC） | 仓位 `pfSellProceeds` |
| 盈亏 | 记在**仓位** `money`；独立卖单行 `money` 恒 0 | 同左 |
| 减仓事件 | `raw.positionEvents.sells[]`（审计 + 展示优先） | 同左 |
| 影子卖单行 | `pmSide=sell` + `pmBuyOrderId`（迁移期保留） | `pfSide=sell` + `pfBuyOrderId` |
| 归账日 | 影子卖单跟仓位 `CreateAt`；跨日 `mergePredictionBuySellSiblings` | 同左 |

### `positionEvents.sells[]` 契约

权威盈亏/回款仍以仓位聚合字段为准；事件是流水与侧栏展示源（按 `id` 幂等 upsert，空数组不清空）。

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 场馆 sell orderId |
| `at` | 是 | 成交时间 ms |
| `shares` | 是 | 减仓份额 |
| `proceeds` | 是 | 回款（PM=USDC，PF=USDT） |
| `price` | 否 | 成交价 |
| `pnl` | 否 | 该笔已实现盈亏（同币种） |
| `origin` | 否 | `changmen` \| `external` |
| `status` | 否 | 如 `closed` |

迁移路线（expand-contract）：读只认仓位（Phase 1 ✅）→ 写入以仓位+事件为成功条件 → **禁止 sync 回流 sell 行** → 停写影子行 → 清历史 sell 行。详见 `packages/venue-adapter/polymarket/PM_SELL_CHECKLIST.md` §仓位迁移。

详细 checklist：`packages/venue-adapter/polymarket/PM_SELL_CHECKLIST.md`；PF 契约：`packages/venue-adapter/predictfun/README.md`。

## 运维

当前应用发布不运行 owner 回填、`profiles.accounts → players` 迁移或历史账号清理。账号、订单和凭证维护须按具体需求单独核对目标用户、现状、备份、执行与验收方案；不得跨 profile 复制凭证。

旧账号迁移、账本巡检及事故修复脚本已归 `rds/maintenance/legacy/`，参见 [历史维护说明](../rds/maintenance/legacy/README.md)。旧 backend 命令路径已退役，不恢复转发入口，也不将历史脚本作为日常部署顺序。历史脚本仍需核对参数、依赖和实际读写行为，不能仅凭名称认定为只读。

数据库结构核验从仓库根运行 `npm run check:rds-schema --workspace=@changmen/backend`，只读检查实际数据库，不回填账号。具体迁移独立执行，发布与回滚边界见 [独立部署](INDEPENDENT_DEPLOYMENT.md)。

经审核手动维护 RDS 后，由服务端调用 `loadProfileById(uid)` 重新加载该用户缓存，或通过受管后端发布/重启流程刷新；不能把直接改库等同于当前进程缓存已更新。

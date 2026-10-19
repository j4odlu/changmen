# OB 状态来源对照（HTTP 初始化 ↔ MQTT 增量 ↔ 统一语义）

本文说明 **比赛 / 地图 / 盘口** 三层状态分别从哪来、如何合并、代码里对应哪个字段。

> **生产路径**：浏览器 `collect.ts` / `markets.ts` / `mqtt.ts` → `API_SaveMatch` / `API_SaveBet`。下文中的「snapshot」多指 **CLI `core.js` 内存结构**或归一化语义，不是已删除的 ObFeed。

实现入口：

- [../README.md](../README.md) — 登录 URL、CLI
- `node/core.js` — `describeMatchStatus` / `describeStageStatus` / `describeMarketStatus`、`applyMqttPayload`
- `shared/save_bets.ts` — HTTP 锁盘（浏览器 SaveBet 共用）
- `node/scripts/fetch_ob_mqtt.js` — 调试 MQTT 原始事件

---

## 1. 数据流总览

```text
┌─────────────────────────────────────────────────────────────────┐
│  HTTP 初始化（每 30s sync + 首次启动）                              │
├─────────────────────────────────────────────────────────────────┤
│  game/index     → 比赛列表 + 比赛级状态（is_live, score, …）       │
│  game/view      → 每 stage 盘口快照 + 盘口 status/visible/suspended │
│  game/getTimer  → 当前进行中的地图 round（地图级辅助）              │
└─────────────────────────────────────────────────────────────────┘
                              ↓ 写入 platform_matches（客户端 API_SaveMatch；ObFeed 已删除）
┌─────────────────────────────────────────────────────────────────┐
│  MQTT 增量（每场订阅 9 个 topic，仅更新已存在 odds/market）         │
├─────────────────────────────────────────────────────────────────┤
│  market.oddsUpdate      → 赔率 odd                                 │
│  market.statusUpdate    → 盘口 locked                              │
│  market.suspended       → 盘口 locked                              │
│  market.visible         → 盘口 locked                              │
│  odd.statusUpdate/…     → 单条 odds locked                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓ applyMqttPayload → applyMqttChanges
                         刷新 stageStatus + snapshot
```

**要点：** MQTT **不推送整场比赛对象**；比赛级 `is_live/score` 靠定时 `game/index` 刷新；地图/盘口靠 `game/view` 打底 + MQTT 改主盘与子盘。

---

## 2. 三层统一语义（归一化字段）

| 层级 | 字段（core / 文档） | code 示例 | 来源 |
|------|---------------|-----------|------|
| **比赛** | `matchStatus` | `scheduled` / `live` / `suspended` / `hidden` |  primarily `game/index` |
| **地图** | `stages[].stageStatus` | `open` / `locked` / `suspended` / `settled` | `game/view` 主盘 + MQTT + `getTimer` |
| **盘口** | `winMarketStatus`（主盘） | 同 MARKET_STATUS | `game/view` + MQTT |

---

## 3. 比赛级：game/index → matchStatus

| OB 原始字段 (`game/index`) | 内部字段 | 参与 matchStatus | 说明 |
|---------------------------|----------|------------------|------|
| `is_live` | `isLive` | **是** | `1` 未开赛，`2` 进行中 |
| `status` | `status` | 辅助 | 列表常见 `5`，语义未公开 |
| `score` | `score` | **是** | 大比分，如 `1:0` |
| `suspended` | `suspended` | **是** | `1` → 整场暂停 |
| `visible` | `visible` | **是** | `≠1` → 不可见 |
| `close_time` | `closeTime` | 保留 | 封盘时间（秒） |
| `bet_delay_time` | `betDelayTime` | 保留 | 滚球延迟 |

**MQTT：** 无 `/match/*` topic；`is_live/score` **不会**从 MQTT 直接更新，依赖下次 `sync()` 重拉 `game/index`。

**合并规则 (`describeMatchStatus`)：**

1. `visible ≠ 1` → `hidden`
2. else `suspended = 1` → `suspended`（整场暂停）
3. else `is_live = 2` → `live`（带 score）
4. else `is_live = 1` → `scheduled`

---

## 4. 地图级：stage_id + getTimer + 主盘 MQTT → stageStatus

| 来源 | 字段 | 作用 |
|------|------|------|
| `game/view?stage_id=N` | 该 stage 全部 market | 初始化 `stages[N]` |
| `pickWinMarket` | 获胜主盘 | `winLocked` / `winMarketStatus` |
| `game/getTimer` | `match_id`, `round`, `start_time` | `isCurrentMap`（当前局） |
| MQTT 锁盘事件 | `market_id` / `odds_id` | 更新对应 stage 的 `winLocked` |

**stage_id 与地图：**

| stage_id | 含义 |
|----------|------|
| `0` | 全场（series） |
| `1..bo` | 地图 1..N（BO3 时为 1,2,3） |

**合并规则 (`describeStageStatus`)：**

- 主盘 `winMarketStatus.code === settled` → 地图 `settled`
- else `winLocked` → `locked` / `suspended`（沿用主盘 label）
- else → `open`
- 若 `getTimer.round === stageId` 且比赛 `is_live=2` → label 追加「当前局」

---

## 5. 盘口级：game/view + MQTT → marketStatus

选盘（取哪一条「获胜」主盘）见 [docs/CATALOG.md](../../../../docs/CATALOG.md) §4 → OB `match_winner`。

详见 [MARKET_STATUS.md](./MARKET_STATUS.md)。

| 来源 | 更新内容 |
|------|----------|
| HTTP `game/view` | 全量 `status`, `visible`, `suspended`, `marketStatus` |
| MQTT `market.*` / `odd.*` | 增量 `locked`（CLI 内存中汇总到主盘 `winMarketStatus`） |

**MQTT topic → 行为：**

| topic | payload | 内部 change.type |
|-------|---------|------------------|
| `/market/oddsUpdate/{id}` | `id`, `odd` | `oddsUpdate` |
| `/market/statusUpdate/{id}` | `market_id`, `status?` | `market.statusUpdate` |
| `/market/suspended/{id}` | `market_id`, `suspended` | `market.suspended` |
| `/market/visible/{id}` | `market_id`, `visible` | `market.visible` |
| `/odd/statusUpdate/{id}` | `id`, `status` | `odd.statusUpdate` |
| `/odd/visible/{id}` | `id`, `visible` | `odd.visible` |
| `/odd/suspended/{id}` | `id`, `suspended` | `odd.suspended` |

---

## 6. 代码调用示例

```javascript
const Core = require("./ob_core.js");

// 比赛：来自 index 条目
const matchFields = Core.extractMatchFieldsFromIndex(indexRow);
const matchStatus = Core.describeMatchStatus(matchFields);

// 地图：view 主盘 + timer
const stageStatus = Core.describeStageStatus({
  stageId: 1,
  winLocked: false,
  winMarketStatus: { code: "open", label: "可投注" },
  timer: { round: 1, startTime: Date.now() },
  isLive: 2,
});

// 盘口
const marketStatus = Core.describeMarketStatus({
  status: 6,
  visible: 1,
  suspended: 0,
});
```

---

## 7. 调试命令

```bash
# 比赛 index 字段分布
node scripts/platforms/ob/probe_game_index.js

# 单场全盘口状态
node scripts/platforms/ob/fetch_ob_view.js --match <id> --stage 1

# MQTT 原始增量
node scripts/platforms/ob/fetch_ob_mqtt.js --match <id> --duration 60

# index + view + getTimer 批量
node scripts/platforms/ob/fetch_ob_live.js --max-matches 3
```

---

## 8. 与其他平台（TF / RAY）的关系

各平台原始字段不同，**不应**共用一张「原始值配置表」。接入 TF/RAY 时：

1. 在 `server/platform-probes/<id>/core.js` 实现各自的 `describeMatchStatus` / `describeMarketStatus`
2. 浏览器与服务端展示应对齐 **SaveBet / fo / GetMatchs** 契约，而非共用 OB 原始 `is_live=2` 等字面量

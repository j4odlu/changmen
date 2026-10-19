# OB 盘口状态说明

本文档说明如何判断 OB 盘口是否可投注，以及 HTTP / MQTT 各字段与内部 `locked` 的对应关系。

> **锁盘观察（日常）**：`packages/venue-adapter/ob/shared/lock_decision.ts` + `npm run ob:lock-observe`（fixture）。
> **适用范围**：主要描述 `core.js`（CLI / `applyMqttPayload`）。**生产 UI** 使用 `mqtt.ts`…

相关代码：`node/core.js`（`isMarketLocked`、`describeMarketStatus`、`applyMqttPayload`）
探测脚本：`node/scripts/probe_market_status.js`（`npm run ob:probe-index` 等同目录其它 probe）

---

## 1. 三层「状态」不要混用

| 层级 | 字段示例 | 含义 |
|------|----------|------|
| **HTTP 响应壳** | `json.status === "true"` | 接口是否成功，**不是**盘口状态 |
| **比赛级**（`game/index`） | `is_live`、`status` | 赛程/直播态，**不是**单个盘口 |
| **盘口级**（`game/view`） | `status`、`visible`、`suspended` | **判断能否展示/投注的核心** |

比赛 `game/index.status` 常见为 `5`；盘口 `game/view.status` 开放时为 `6`。**两者数值不同、语义不同。**

---

## 2. 盘口是否锁盘：统一判定公式

```javascript
const Core = require("./ob_core.js");

Core.isMarketLocked({ status, visible, suspended });
// locked === true  → 不可投注（锁盘/暂停/隐藏/已结算等）
// locked === false → 可投注
```

**开放条件（三者同时满足）：**

| 字段 | 开放值 | 非开放时的含义 |
|------|--------|----------------|
| `status` | **`6`** | 非 6：锁盘、结算中等（见下表） |
| `visible` | **`1`** | 非 1：前端不展示该盘 |
| `suspended` | **`0`** | `1`：暂停/封盘（常伴随 `suspended_type`） |

与 A8 采集端、浏览器插件逻辑一致（规则见 [docs/CATALOG.md](../../../../docs/CATALOG.md) §4 → OB `openWhen`）：

```javascript
locked = status !== 6 || visible !== 1 || suspended !== 0
```

可读标签：

```javascript
Core.describeMarketStatus({ status, visible, suspended, settle_count });
// → { locked, code, label, reasons[] }
// code: open | suspended | hidden | locked | settled
// label: 可投注 | 暂停 | 不可见 | 锁盘 | 已结算
```

---

## 3. `game/view` 盘口字段对照

| OB 原始字段 | 类型 | 内部字段 | 参与 locked？ |
|-------------|------|----------|---------------|
| `id` | string | `marketId` | — |
| `round` | number | `round` | — |
| `cn_name` | string | `marketName` | — |
| **`status`** | number | `status` | **是** |
| **`visible`** | number | `visible` | **是** |
| **`suspended`** | number | `suspended` | **是** |
| `settle_count` | number | `settleCount` | 辅助判断「已结算」 |
| `suspended_type` | number | （raw） | 暂停原因，未参与 locked |
| `visible_type` | number | （raw） | 隐藏原因，未参与 locked |
| `odds.{key}.id/odd/name` | — | `odds[]` | 赔率本身无 status |

归一化后每条盘口还带 `marketStatus: { code, label, reasons }`（见 `normalizeGameView`）。

---

## 4. `status` 数值观测（盘口级）

> OB 未公开官方枚举；下表来自 `game/view` 样本 + `probe_market_status.js` 扫描。**带「推测」的需随样本更新。**

| status | visible | suspended | settle_count | locked | 推断语义 | 置信度 |
|--------|---------|-----------|--------------|--------|----------|--------|
| **6** | 1 | 0 | 0 | false | **可投注** | 已确认（2026-05-24 探测） |
| **6** | 1 | 1 | 0 | true | 暂停（滚球封盘等） | 已确认 |
| **7** | 1 | 0 | 0 | true | 锁盘/停投（非获胜类盘口常见） | 已确认（探测占比最高） |
| **9** | 1 | 0 | ≥1 | true | **已结算** | 已确认 |
| **12** | 0 | 0 | ≥1 | true | **已结算** + 不可见 | 已确认（2026-05-24 探测） |

最近一次探测（3 场 / stage 0 / 34 盘口）：`7|1|0`×20、`12|0|0|1`×10、`6|1|1`×2、`9|1|0|1`×1、开放 `6|1|0|0`×1。

运行探测脚本可刷新当前环境分布：

```bash
node scripts/platforms/ob/probe_market_status.js --matches 10 --stages 0,1
```

---

## 5. 比赛级字段（`game/index`）

| 字段 | 值 | 含义 | 代码 |
|------|-----|------|------|
| `is_live` | `1` | 未开赛 / 可展示 | `liveStatusLabel(1)` → 「未开赛」 |
| `is_live` | `2` | **进行中** | `liveStatusLabel(2)` → 「进行中」 |
| `status` | `5` | 当日列表常见值，表示比赛在可展示赛程中 | 见 [GAME_INDEX.md](./GAME_INDEX.md) |
| `score` | 如 `1:0` | 大比分 | — |

比赛级 `status=5` **不能**代替盘口 `status=6` 使用。

---

## 6. MQTT 实时更新与 locked 映射

订阅 topic（每场 matchId）：

```text
/market/oddsUpdate/{matchId}
/market/statusUpdate/{matchId}
/market/suspended/{matchId}
/market/visible/{matchId}
/odd/statusUpdate/{matchId}
/odd/visible/{matchId}
/odd/suspended/{matchId}
...
```

| MQTT type | payload 关键字段 | locked 更新规则 |
|-----------|------------------|-----------------|
| `market.oddsUpdate` | `id`, `odd` | **不变** locked，只改赔率 |
| `market.statusUpdate` | `market_id`, `status?`, `visible?`, `suspended?` | 有 `status` 时用 `isMarketLocked`；否则视为锁盘 |
| `market.suspended` | `market_id`, `suspended` | `locked = (suspended === 1)` |
| `market.visible` | `market_id`, `visible` | `locked = (visible !== 1)` |
| `odd.statusUpdate` | `id`, `status`, … | 按 `isMarketLocked` 更新该 odds 行 |
| `odd.visible` | `id`, `visible` | `locked = (visible !== 1)` |
| `odd.suspended` | `id`, `suspended` | `locked = (suspended === 1)` |

实现位置：`node/core.js` → `applyMqttPayload`（CLI）。浏览器见 `mqtt.ts`。

**注意：** MQTT 在 CLI 内存中更新 `currentOdds[].locked`；浏览器侧写入 Pinia `oddsStore`（fo），经 `getOdds` 展示。

---

## 7. 内部数据结构

### HTTP 快照（单场 stage）

```javascript
{
  marketId, marketName, round,
  status, visible, suspended, settleCount,
  locked,                    // boolean，是否锁盘
  marketStatus: { code, label, reasons },
  odds: [{ oddsId, odd, side, ... }]
}
```

### 浏览器 fo / GetMatchs

| 字段 | 来源 | UI |
|------|------|-----|
| `oddsStore` / fo `locked` | `mqtt.ts` + HTTP `markets.ts` | 套利列表赔率与锁态 |
| `client_matches.bets` | SaveBet → matcher（仅 HTTP 快照） | `GetMatchs`；非 HG 时 OB 列**不**作 fo fallback |

历史 ObFeed / Dashboard 已删除。

---

## 8. 调试命令

```bat
cd changmen/packages/venue-adapter
npm run ob:view -- --match <matchId> --stage 0
node node/ob/scripts/probe_market_status.js
npm run ob:mqtt -- --match <matchId> --stage 0 --duration 120
```

---

## 9. 代码示例

```javascript
const Core = require("./ob_core.js");

// 原始 API 盘口
const raw = { status: 6, visible: 1, suspended: 0, settle_count: 0 };
Core.isMarketLocked(raw);           // false
Core.describeMarketStatus(raw);     // { locked: false, code: 'open', label: '可投注', ... }

// 暂停
Core.describeMarketStatus({ status: 6, visible: 1, suspended: 1 });
// → { locked: true, code: 'suspended', label: '暂停', ... }
```

---

## 10. 已知限制

1. **`status` 完整枚举未公开**：除 `6=开放` 外，7/9 等依赖样本推断，需定期跑 `probe_market_status.js` 校对。
2. **`suspended_type` / `visible_type`** 暂未映射到中文原因，仅写入 `reasons` 调试信息。
3. **组合盘 / 非「获胜」主盘**：UI 主盘选取见 `markets.ts` / `pickWinMarket`。
4. **比赛级与盘口级**：`is_live=2` 表示比赛进行中，但不保证每个子盘 `status=6`（滚球常出现 suspended）。

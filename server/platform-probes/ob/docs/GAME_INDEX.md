# OB `game/index` 参数说明

实测网关：`{gateway}/game/index?game_id=&flag=&day=`（北京时间 Asia/Shanghai 自然日）

探测脚本：`node scripts/platforms/ob/probe_game_index.js`

## 参数

| 参数 | 含义 | 实测结论 |
|------|------|----------|
| `game_id` | 游戏类型过滤 | `0` = 全部游戏；具体 ID 见 [GAME_IDS.md](./GAME_IDS.md)，如 CS2=`257578064923863` |
| `flag` | 赛程视图模式 | 决定返回哪一类时间范围内的比赛（见下表） |
| `day` | 日期偏移 | **仅部分 flag 生效**；与 `flag` 组合表示「今天 / 明天 / 未来第 N 天」 |

## flag 取值（2026-05-24 实测）

| flag | day | 返回场数 | 开赛日期（北京时间） | 说明 |
|------|-----|---------|---------------------|------|
| **0** | 任意 | 115 | 05-24 ~ 06-04 | **全部**可见赛程；`day` 被忽略 |
| **1** | 0 或 1 | 41 | 仅 05-24 | **今日**全部赛程；`day` 被忽略（A8 默认 `flag=1&day=1`） |
| **2** | 0 | 20 | 仅 05-24 | 今日子集（⊂ flag=1，多为仍有盘口/未结束场次） |
| **2** | 1 | 7 | 仅 05-25 | **明日**赛程 |
| **2** | 2 | 17 | 仅 05-26 | **后天**赛程 |
| **2** | 3 | 20 | 仅 05-27 | 未来 +3 日（相对今天） |
| **3** | 1 | 69 | 05-24 ~ 05-31 | **近一周**汇总（含今日，跨度约 8 天） |
| **4** | 1 | 7 | 仅 05-25 | 与 `flag=2&day=1` 结果一致 |
| **4** | 2 | 17 | 仅 05-26 | 与 `flag=2&day=2` 结果一致 |
| **5** | 0 | ~11 | 05-24 较早时段 | **已结束**（接口偶发空响应，不稳定） |

### 推荐使用方式

| 需求 | 请求 |
|------|------|
| 今日全部 | `flag=1&day=1` |
| 明日 | `flag=2&day=1` |
| 未来第 N 天（N≥2） | `flag=2&day=N` |
| 近 7~8 天一次拉齐 | `flag=3&day=1` |
| 平台全部可见赛程 | `flag=0&day=0` |

> **不要用客户端 `start_time` 截断代替 API**：例如原先 `start_time < now+3h` + `slice(15)` 会丢比赛；应通过多次 `flag/day` 查询合并，或一次 `flag=0` / `flag=3`。

## 响应字段：是否「正在进行」

API **没有**单独的「只返回进行中」query 参数；需看每条比赛的字段：

| 字段 | 实测值 | 含义 |
|------|--------|------|
| `is_live` | `1` | 未开赛 / 可展示盘口（比分常为 `0:0`） |
| `is_live` | `2` | **进行中**（已有比分，如 `1:0`） |
| `status` | `5` | 当日列表中均为 `5`（可投注态，具体枚举未公开） |
| `start_time` | Unix 秒 | 开赛时间；与 flag 组合使用，**不要**再用客户端小时窗口替代 flag |
| `score` | 如 `1:0` | 当前大比分 |

盘口级 `status/visible/suspended` 与锁盘规则见 [MARKET_STATUS.md](./MARKET_STATUS.md)。  
HTTP 与 MQTT 三层状态如何合并见 [STATUS_MAPPING.md](./STATUS_MAPPING.md)。

## 代码中的用法

```javascript
const Core = require("./ob_core.js");

// 今日
Core.buildGameIndexQuery({ gameId: "0", flag: 1, day: 1 });
// → /game/index?game_id=0&flag=1&day=1

// 明日
Core.buildGameIndexQuery({ gameId: "0", flag: 2, day: 1 });

Core.describeIndexSource(2, 1); // { scope: "tomorrow", label: "明日" }
Core.liveStatusLabel(2);        // "进行中"
```

`ob_feed.js` 默认按 `indexSources` 依次请求今日 + 明日 + 未来若干天，按 `matchId` 去重并打上 `scheduleScope`，**不再**做 `maxMatches` / 3 小时过滤。

## 与 A8 采集端一致

A8 前端（`index.js`）固定调用 `flag=1&day=1`，再 **客户端**过滤 `start_time < now+3600` 与配置游戏列表——那是采集策略，不是 OB API 语义。本项目的 OB 仪表盘改为以 API 参数区分赛程日。

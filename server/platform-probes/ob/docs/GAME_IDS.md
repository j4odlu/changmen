# OB 游戏类型代码（game_id）

OB 比赛列表接口 `GET {gateway}/game/index` 返回的每条比赛带有 **`game_id`** 字段（字符串型 Snowflake ID），用于区分电竞项目。  
接口本身**不返回**游戏中文名，需通过联赛样本、订单历史或 CDN 资源列表对照识别。

## 数据文件

| 文件 | 说明 |
|------|------|
| `ob_game_ids.json` | 机器可读 catalog，`games[game_id]` 含 name / code / verified / hints |
| `ob_game_ids.js` | `getGameName(gameId)`、`getGameCode(gameId)`、`listKnownGames()` |
| `collect_game_ids.js` | 从 live index + CDN 合并新 ID 与联赛 hints（不覆盖已验证名称） |

更新 catalog：

```bash
node scripts/platforms/ob/collect_game_ids.js
```

CDN 全量 game_id 列表（无名称）：

```
https://uphw-cdn4.shudarong.com/upload/json/pc.json  →  game_imag 对象的 key
```

## 已验证 game_id

| game_id | 中文名 | 代码 | 识别依据 |
|---------|--------|------|----------|
| `257154660915053` | 英雄联盟 | `lol` | LCS / LPL / LEC 等联赛 |
| `257578064923863` | CS2 | `cs2` | CCT、BB 风暴、征服布拉格 |
| `271192272576750` | 无畏契约 | `valorant` | VCT / VCL |
| `257289795134339` | DOTA2 | `dota2` | 梦幻联赛、订单 game 字段 |
| `257561197207055` | 王者荣耀 | `kog` | KPL 战队名（AG超玩会等） |
| `101258749512819384` | 无尽对决 | `mlbb` | MPL 马来西亚/印尼 |
| `257532676759026` | 守望先锋 | `ow` | OWCS |
| `1377370776735090` | 穿越火线 | `cf` | CFML / CFPL |
| `258006510157846` | 星际争霸 | `sc` | RSL 复兴 |

## 在代码中使用

```javascript
const { getGameName, getGameCode } = require("./ob_game_ids.js");

const name = getGameName("257578064923863"); // "CS2"
const code = getGameCode("257578064923863"); // "cs2"
```

网页 feed（`ob_feed.js`）已在 snapshot 中附带 `gameName`、`gameCode`。

## 与跨平台 game_code 的对应

本项目聚合范围以 [docs/CATALOG.md](../../../../docs/CATALOG.md) §3 / [`game_catalog.json`](../../../../packages/shared/catalog/game_catalog.json) 为准（CS2、王者荣耀、无畏契约、英雄联盟、DOTA2）。

| game_code | OB game_id | RAY game_id |
|-----------|------------|-------------|
| `cs2` | `257578064923863` | `140` |
| `kog` | `257561197207055` | `74` |
| `valorant` | `271192272576750` | `37197927` |
| `lol` | `257154660915053` | `70` |
| `dota2` | `257289795134339` | `151` |

A8 等第三方聚合平台使用**另一套**数字 ID，与 OB Snowflake **不能混用**。  
本目录 `ob_game_ids.json` 维护 **OB 原生全量 ID**；跨平台对齐见 `shared/game_catalog.json`。

详见 [GAME_INDEX.md](./GAME_INDEX.md)（`flag` / `day` 参数含义）。

## 盘口 stage 与地图

- `game/view?match_id=&stage_id=0` → 全场盘（round=0，如 `[全场]-全局 - 获胜`）
- `stage_id=1..N` → 各地图/局（round 与 stage_id 一致，如 `[地图1]-单局 - 获胜`）
- BO 场次：`bo=1` 仅拉 stage `0`；`bo>1` 拉 `0..bo`（与 A8 前端 NMe 逻辑一致）

## 待确认 ID

`ob_game_ids.json` 中 `verified: false` 的条目来自 CDN 或尚未对照联赛的 ID。  
运行 `collect_game_ids.js` 会写入 `hints`（当日 index 中出现的联赛名），便于人工补全 `name` 后将 `verified` 设为 `true`。

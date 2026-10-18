# Catalog 体系（游戏 · 运动 · 玩法）

> **单一真相源**：`packages/shared/catalog/*.json`  
> 本文描述字段语义与扩展规则；原 `server/backend/GAMES.md` / `MARKETS.md` 已删除，内容并入本文。

代码入口：

- `packages/shared/catalog/game_catalog.ts` / `.json`
- `packages/shared/catalog/market_catalog.ts` / `.json`
- `packages/shared/catalog/sport_catalog.json`（**草案**，尚未接入运行时）

---

## 1. 三层关系

```
sport_catalog（运动）
    └── game_catalog（赛事类型：cs2、mlb…）
            └── market_catalog（玩法：match_winner、moneyline…）
```

| 层 | 文件 | 职责 |
|----|------|------|
| 运动 | `sport_catalog.json` | 比赛类型元数据、matcher 配置、默认 game 列表（见 [ARB_MULTI_SPORT.md](./ARB_MULTI_SPORT.md)） |
| 游戏 | `game_catalog.json` | 跨平台 `game_id` → 统一 `code` |
| 玩法 | `market_catalog.json` | 源站原始盘口 → 统一 `market.code` |

---

## 2. `sport_catalog.json`（草案）

路径：`packages/shared/catalog/sport_catalog.json`

### 2.1 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `version` | number |  schema 版本，当前 `1` |
| `updatedAt` | string | ISO 日期 |
| `description` | string | 人读说明 |
| `sports` | array | 运动条目列表 |

### 2.2 `sports[]` 条目

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `code` | string | ✅ | 稳定 ID：`esport`、`baseball` |
| `name` | string | ✅ | 中文名 |
| `nameEn` | string | | 英文名 |
| `status` | enum | ✅ | `active` \| `planned` \| `deprecated` |
| `defaultGameCodes` | string[] | | 默认启用的 `game_catalog.code` 列表 |
| `matcherProfile` | string | | 合并配置名，对应 `server/match/identity/profiles/{name}.js`（规划） |
| `linePath` | string | | 产品线锚点目录，如 `lines/baseball`；与 `lines/{code}/line.json` 对应 |
| `apiSportFilter` | string | | `Client_GetMatchs` 过滤值，通常与 `code` 相同 |
| `pm2Apps` | string[] | | 关联 PM2 进程名 |
| `collect` | object | | 采集策略（见下） |
| `markets` | string[] | | 启用的 `market_catalog.code` 列表 |

### 2.3 `collect` 对象

| 字段 | 类型 | 说明 |
|------|------|------|
| `mode` | enum | `browser`（客户端 venue-adapter）\| `daemon`（VPS collector）\| `both` |
| `daemons` | string[] | workspace 名，如 `@changmen/polymarket-sports` |
| `platforms` | string[] | 参与采集的平台 ID（manifest） |

### 2.4 示例条目（草案内容）

**电竞 `esport`** — `status: active`，`defaultGameCodes`: cs2, lol, dota2, valorant, kog，`matcherProfile`: `esport`，`markets`: `match_winner`。

**棒球 `baseball`** — `status: active`（主控台只读 MVP），`defaultGameCodes`: `mlb`，`matcherProfile`: `baseball`，`linePath`: `lines/baseball`，`markets`: `moneyline`。

**足球 `football`** — `status: active`（主控台只读 MVP），`defaultGameCodes`: `soccer`，`matcherProfile`: `football`，`linePath`: `lines/football`，`markets`: `moneyline`。

---

## 3. `game_catalog.json` 扩展

### 3.1 现有字段（不变）

`code`、`name`、`nameEn`、`a8GameId`、`platforms`（各平台 native id）

### 3.2 新增字段（阶段 1，向后兼容）

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `sport` | string | `"esport"` | 指向 `sport_catalog.code`；旧条目缺省时视为电竞 |

### 3.2a 场馆游戏配置集中（2026-10-18）

[changmen 扩展] `game_catalog.json` 的 `platforms` 继续保存各场馆原生游戏 ID；新增 `platformSettings` 保存同一游戏的场馆别名及采集发现参数。浏览器与 Node 共用 `game_catalog_rules.ts`，保留 `.js` 转发入口以兼容后端路由编译，并通过已有 `@changmen/shared/catalog/game_catalog` 入口导出；原查询接口保持兼容，不新增 package exports。

[changmen 扩展] `Client_GetGames` 对所有场馆直接读取 `game_catalog.json` 的电竞条目，按目录顺序去重，并继续追加平台运行配置中的 `games`。`venue_games.json` 仅保留公开 JSON 导入兼容的历史快照，不再作为运行时配置或要求与当前目录同步；新增游戏只维护集中目录。API 回归覆盖目录新增、修改、删除、非电竞排除及动态追加。

| 字段（`platformSettings.<场馆>` 下） | 用途 |
| --- | --- |
| `aliases` | 该游戏的场馆原始 ID/slug 别名 |
| `caseInsensitiveAliases` | 别名是否忽略大小写；默认否，保留原场馆识别行为 |
| `collection.order` | 采集列表顺序；未配置的游戏排在已有项之后 |
| `collection.sportKeys` | PM `/sports` 发现键；缺省使用 `platforms` 中的 ID |
| `collection.fallbackSeriesIds` | PM `/sports` 不可用时的 series 兜底 |
| `collection.textPattern` | 场馆市场元数据的游戏识别正则（忽略大小写） |
| `collection.textMatchOrder` | 文本同时命中多个游戏时的识别优先级 |

RAY 浏览器及探针凭证对象的 `games` 均从公共配置生成；PM 赛事 collector 的 sport keys、series 兜底和游戏识别，以及 `polymarket-sports/gamma_map.js` 比分身份索引的 sport keys、series 兜底，也从公共配置生成。公共查询原有 PB、Stake、PM、Limitless、SXBet、Azuro、TF 别名已迁入同一 JSON。

本次迁移保持原五个游戏及各场馆识别结果，未接入篮球。`AGGREGATE_GAME_CODES` 对原服务端 active-game 查询的作用保持；RAY/PM 静态采集范围不新增环境变量门控。游戏采集只读取本文件的电竞条目，`game_catalog_sports.json` 的独立体育类目不进入该范围。盘口选盘规则仍由 `market_catalog.json` 管理。

改配置后需重新构建前端、重启对应 Node collector。新增类目应先补原生 ID、发现参数与文本识别规则，再按 `market_catalog` 核对盘口；无需在 RAY/PM 适配器另写游戏白名单。

FOK 固定基线未替换。`scripts/verification/game-catalog-centralization-increments.json` 精确登记配置迁移，继续全文核对原受保护模块，并校验新配置及公共规则实现。后续改变游戏范围时须同步审查该精确迁移契约，不能直接更新原 VPS baseline 或豁免目录。

### 3.3 棒球预留条目（阶段 B2 写入）

```json
{
  "code": "mlb",
  "sport": "baseball",
  "name": "MLB",
  "nameEn": "Major League Baseball",
  "platforms": {
    "Polymarket": "mlb",
    "PB": "baseball"
  }
}
```

`platforms` 各键需在接入时实测补全；PM 侧 `sport` slug 为 `mlb`（`/sports` id=8）。

### 3.4 环境变量（现有 + 规划）

| 变量 | 说明 |
|------|------|
| `AGGREGATE_GAME_CODES` | 逗号分隔子集；电竞沿用 |
| `AGGREGATE_SPORT` | **规划**：单运动部署时设 `baseball`，限制 matcher + GetMatchs |

---

## 4. `market_catalog.json`

### 4.1 比赛 × 局段 × 盘口（冻结口径）

三层模型（见 [ARB_MULTI_SPORT.md §2.1](./ARB_MULTI_SPORT.md)）：

```text
比赛（match）
  └── 局段（period：全场 / 地图N / 上半场…）   ← 电竞 Map ≈ 球类半场
        └── 盘口（market：胜负、让分…）
```

| 口径 | 说明 |
|------|------|
| **地图 = 局段** | 类比足球/棒球上半场、下半场；不是 sport，也不等于「一种玩法」本身 |
| **当前主做** | 各局段上的 **胜负**（电竞：全场 + 各地图；棒球一期：全场 moneyline） |
| **后期** | 同一局段可加其它盘口；也可扩展新局段 —— 走 catalog / `round` 映射，禁止假设「只有全场」或「只有胜负」 |

实现上局段常落在 `round`（0=全场，n=地图 n）或等价字段；玩法落在 `market_catalog`。

### 4.2 与 A8 `index0706.js` 的关系

`A8/index0706.js` 混有两层逻辑，不要混为一谈：

| 层级 | A8 在做什么 | 数据形态 |
|------|-------------|----------|
| **页面 / Dashboard** | 读 A8 API、`fo` 缓存、聚合 WS | 已整理：比赛、盘口名、主客赔率已对齐 |
| **浏览器插件采集** | 直连 OB/RAY 源站 HTTP，再 `saveBets` 上传 | **原始 API** → 本地用 `betName` 正则筛盘 |

changmen = 插件采集层 + 自建 Dashboard。规则写在 **`market_catalog`**，在源站原始字段上生效；**不能**以 A8 页面里的 `BetName` 反推选盘规则。

### 4.3 判定模型

对每个 `market.code`（如 `match_winner`），在对应平台源站数据上选盘（并绑定局段 `round`）：

```text
OB（已配置 gameOddTypes 的游戏，如 CS2）
    → odd_type_id + round 精确匹配
    → excludeIf / require @T1@T2

OB（未配置的游戏） / RAY
    → testOn 字段 + RegExp(betName)
    → excludeIf / require
    → 命中则 marketCode = match_winner
```

### 4.4 电竞现状：局段上的胜负（`match_winner`）

- **OB**：`game/view` 中 `odd_type_id` + `round`（局段）；CS2 等 `gameOddTypes.full|map` 见 `market_catalog.json`
- **RAY**：`group_name` 匹配 `^获胜者$`；排除 status=4
- **OB 回退**：未配 `odd_type_id` 时用 `betKey` / `cn_name` 正则

刷新 OB 玩法类型码：`node scripts/platforms/ob/collect_odd_type_ids.js --write`（在 `server/backend` 或探针目录，视脚本位置而定）。

代码入口：`resolveMarketCode('OB', { market, raw })`；OB `obPickWinMarket`、RAY `rayIsAggregatedOddsRow`（`market_catalog.mjs`）。

> `round=0` / `map` 区分 **局段**；玩法同属胜负语义族。若后期拆独立 market code 或新局段，走 catalog 扩容。

### 4.5 运动 profile（规划）

| 字段 | 说明 |
|------|------|
| `sportProfiles` | 按 `matcherProfile` 覆盖选盘 / 局段规则 |
| `esport` | 多局段（全场 + 地图）、`odd_type_id` |
| `baseball` | 一期全场 moneyline；局段/其它盘口后期 |

### 4.6 棒球玩法（规划）

| code | 名称 | 说明 |
|------|------|------|
| `moneyline` | 胜负（全场局段） | 2 路；套利 MVP |
| `run_line` | 让分 | 后期（仍挂在某一局段上） |
| `total` | 大小分 | 后期 |

**MVP**：先做全场 moneyline；模型仍按「比赛 → 局段 → 盘口」承接半场/其它玩法。

---

## 5. 运行时接入点

### 阶段 1 已完成（2026-07-13）

| 组件 | 状态 |
|------|------|
| `game_catalog.json` | 每项 `sport: esport` |
| `game_catalog.ts` | `getGameSport()`、`DEFAULT_GAME_SPORT` |
| `sport_catalog.ts` | `getSport()`、`listActiveSports()`、`getSportForGameCode()` |
| `npm run test:catalog-smoke` | 含 `sport_catalog_smoke.test.ts` |

### 留待棒球 B2（不改行为）

| 组件 | 改动 |
|------|------|
| `server/match/identity` | `matcherProfile` 分支：跳过 Map/promote（baseball） |
| `server/match/matcher` | merge 输入按 sport 过滤 `platform_*` |
| `router.ts` `Client_GetMatchs` | 请求体可选 `sport` |

---

## 6. 与文档/目录的对应

| 文档 / 配置 | 职责 |
|-------------|------|
| 本文 §3 | 原 `GAMES.md` 内容（游戏类型） |
| 本文 §4 | 原 `MARKETS.md` 内容（玩法 / 选盘） |
| [SPORTS_PRODUCT_LINES.md](./SPORTS_PRODUCT_LINES.md) | 产品线 + 棒球路线 |
| `packages/shared/catalog/*.json` | **唯一配置源** |

---

## 7. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-07-13 | P0.5：`productPath` 更名为 `linePath`；锚点 `lines/{code}/` |
| 2026-07-13 | P0：删除 GAMES/MARKETS 指针；`sports/` 并入 SPORTS_PRODUCT_LINES |
| 2026-07-13 | 文档瘦身：readme / GAMES / MARKETS 改指针；选盘细则并入 §4 |
| 2026-07-13 | 初稿：sport_catalog 字段设计；game/market 扩展规划 |

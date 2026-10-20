# 多运动接入 — MVP 与收敛

> **目标**：电竞 `/` 与体育 `/sports` 分页；首页已去掉体育 Tab（Wave B）。  
> **电竞红线**：`Client_GetMatchs` / matcher / `client_matches` / `matchStore` 主循环 **零改动**。

**用户模型**：只打电竞开 `/`；只打体育开 `/sports`（足/篮/棒/网）；都打则双标签。体育页 `sportsSession` **不**启电竞 `mainBetLoop`/采集。

---

## 0. 总原则（硬约束 · 不可破）

**足球（及任何非电竞运动）的需求、实现、回归，绝对不能影响电竞已成熟业务。**

含义：

| 允许 | 禁止 |
|------|------|
| 新 API（`Client_GetFootballMatchs` 等）、`sport_*` 表/缓存、足球 Tab / store | 改 `Client_GetMatchs` / `buildMatchList` / `client_matches` |
| 体育专用 fetch / merge / catalog 的 `football` 段 | 改 matcher、`server/match/identity`、电竞 collector、`mainBetLoop` |
| 可选 DTO 字段（电竞不填则行为不变） | 为足球改电竞 `getBetName` / 下单门控 / fo 语义 |
| 共用投注账号（AccountBar / accountStore / 余额刷新） | 体育读电竞订单 / fo / `mainBetLoop` / 电竞参数配置 / 电竞当日盈亏 |
| `sportOddsStore` + hub 只读体育板 | 「顺手」改 `manualBet` / 账号过滤等电竞路径 |

**判定标准**：电竞列表、赔率 fo、套利主循环、手动/自动下单，在切到足球 Tab、拉足球盘口、合并让球/大小之后，行为须与改前一致。有疑义时 **优先保电竞、砍足球方案**。

验收锚点：`npm run test:catalog-smoke`（含 `esport_isolation_audit`）、`npm run test:frontend`、以及改共享壳时补电竞 `getBetName` / fo 隔离测。

---

## 1. 冻结决策

| 项 | 约定 |
|----|------|
| 正式入口 | `/` 纯电竞 HomeView + 顶栏「体育」链到 `/sports`；`/sports/{football,basketball,baseball,tennis}` + 独立 `Client_Get*Matchs` |
| 隔离 | 新运动 **不写** 电竞 `client_matches` |
| 独立站 | 已弃用；历史归档副本已从仓库移除，不再新建 `{sport}/web` 平行站 |
| 不做（本期） | matcher profile、跨站匹配、按运动套利管线 |
| **Tab ≠ 套利** | Tab 只换列表板；`matchStore.startMainLoop` 与 sportTab **无关**，切到棒球/足球时电竞套利仍可跑 |
| **检测分开** | 棒球/足球套利检测环（未来）**禁止**塞进 `mainBetLoop`；**只共用投注账号**，订单 / 采集 / 参数配置 / 侧栏统计不共用 |
| **列表轮询** | 棒球/足球板 `v-if` 挂载才 `startPolling`，卸装 `stopPolling`；勿多 Tab 齐刷 |

### N1 列表硬化（已做）

- Gamma 无 series：**抛错**（不缓存空列表）；router `fail` → 前端板子显示 `error`
- API `getBaseball/FootballMatchs`：失败抛错，不再静默 `[]`
- 空态与错误态分开展示（有 error 不显示「暂无比赛」）

### N2 列表缓存（已做 · 强制不碰电竞）

- 进程内存（30s）+ 本机 JSON：`storage/sport/{mlb,soccer}/match_list.json`
- **禁止** 读写 RDS `client_matches` / 改 `GetMatchs` / 写电竞 `platform_*`
- Gamma 失败时若有磁盘快照 → 返回 stale 列表；否则 `fail`
- 验收：`rg client_matches` 在 `sport_gamma_fetch` / `sport_list_cache` / `*_gamma_fetch` 中无读写调用（仅有拒绝路径/注释）
- 冒烟：`sport_list_cache.smoke.test.mjs` 已挂入 `npm run test:catalog-smoke`（防路径回退）；`storage/sport/**` 已 gitignore

### 产品冻结（维护态 · 2026-07-25 · 足球让球/大小已接）

多运动：**只读列表 + 本机缓存**；棒球/网球仍可走 PM∥PF `sport_merge`，足球自 2026-09-24 起改为 **PM + OB 场馆独立列表，禁止网页/服务端合场**。电竞路径零污染。
**足球 N3（已做）**：PM 胜负 + **让球/大小全量线**（`MarketCode`/`Line`）；`Game`=联赛码（`epl`/`chi`/…）；UI 经 `game_catalog` 显示中文名。PF 足球 REST 已停。
**允许**：隔离回归修 bug、文档勘误、合并质量（队名别名 / 时间窗 / 联赛解析）小修。  
**禁止**：N4 体育套利环、Sport Team UI 拖线、第三场馆、改 `GetMatchs` / `client_matches` / `mainBetLoop` / fo、把体育套利塞进电竞 `mainBetLoop`。  
**例外（POD 跟单 · 2026-09-14）**：足球页 POD 跟单可走熊猫体育 `yewu13` 单注（预检 `queryBetAmountPB` + 提交 `betPB`），**自动默认关**；禁止电竞 `/game/bet`、`placeValueBetOrder`、`mainBetLoop`、写 `fo`。已下单进足球页独立侧栏（日期/账号筛选 + `.orders` 卡片，对齐电竞 `OrderView` 壳）；读写对齐电竞订单（Pinia 内存 + RDS 强一致），表是 **`football_orders`**（`Client_SaveFootballOrder` / `Client_GetFootballOrders` / 管理端「足球订单」按用户/账号分列），**不写 localStorage**。结算：C201 + 官网 `queryOrderStatus` / `yewurecord getOrderListPB` 轮询回写 `status`/`profit`（侧栏 Win/Lose/待结算），用户栏当日盈亏固定日历今天。**禁止** `Client_SaveOrder` / 电竞 `orderStore` / 电竞 `orders` 表 / 复用 `OrderList` / 电竞 `getOrders`。体育页 `sportsSession` **不**拉 `Client_GetOrderList`，也不跑电竞 `updateOrders`。这不是 N4 套利。  
（电竞 house 已 `PredictFun.bet: true`；与 sport 下注无关。）  
**下一闸门** = 产品要 **自动下单** 再开 **N4** plan；或要对齐新场馆再单开。  
**N4 套利盘口（产品硬规则 · 未实现）**：

| 运动 | N4 套利主盘 | 说明 |
|------|-------------|------|
| **棒球** | 胜负（moneyline，主/客二选一） | 无平局，双边可对敲；`Game`=`mlb`/`kbo`/`npb` 与电竞 cs2/lol **同构**（展示标签 + **同 Game 才合并**） |
| **足球** | **让球 + 大小球** | 有平局；**不以**胜负（1X2 / 单纯主胜客胜）作套利主盘 |

足球胜负盘可继续 **只读展示**，但 **不算** N4 套利标的。仍禁止现在开 N4 / 改 `mainBetLoop` / 写 fo。  
**当前主工作面** = 电竞 A8 — 见 [client/web/docs/A8_NEXT_STEPS.md](../client/web/docs/A8_NEXT_STEPS.md)；**足球/棒球/网球 = 维护态**（隔离回归与文档勘误可做，新功能默认不开）。  
**例外（N3.5）**：体育板赔率实时显示（collector hub → `sportOddsStore`），仍 **禁止** N4 / fo 交叉。  
**N3.6 已于 2026-09-24 退役**：足球不再做浏览器 overlay；PM、OB 各自保留独立比赛和盘口，由 POD 场馆插件分别匹配。见 [§3c](#3c-足球场馆独立列表与-pod-匹配2026-09-24)。
分层隔离定案：数据/循环必须隔离；壳 UI + 场馆 WS（hub）可共用；`BetRow` **不** import `sportOddsStore`（由 `SportMatchBoard` 注入 `oddsDisplayTick`）。

手工验收清单：

1. 电竞列表 + 套利主循环正常（切棒球/足球 Tab 仍跑）
2. 棒球/足球有场；`storage/sport/` 有 JSON；足球页面上同场 PM、OB 必须保持两条独立场馆记录，POD 可分别对上两馆
3. 断网/断 Gamma：有磁盘则 stale 列表，电竞不受影响
4. `rg` / smoke 隔离仍成立；体育板 **不** seed `oddsStore`
5. 改完足球 discovery / snapshot 后重启 `changmen-pm-football-collector`；改 backend 读取逻辑后再重启 backend
6. **N3.5**：棒/足赔率随 WS 变；关 Tab 后体育订阅清空；电竞 fo 无 MLB/soccer token；`BetRow.vue` 无 `sportOddsStore` 引用
7. **足球让球/大小**：PM、OB 各自展示本站供给；不得从另一场馆 overlay 出不存在的盘口

### 历史：Phase 0 合并质量抽检（2026-07-25，2026-09-24 架构切换前）

以下仅保留为旧架构记录，不代表当前足球路径。旧脚本：[`audit-football-merge-coverage.mjs`](../server/backend/scripts/ops/diagnostics/audit-football-merge-coverage.mjs)。当前路径禁止以该脚本结果作为“应合场”验收标准。

| 指标（当次） | 结果 |
|--------------|------|
| 总场次 | 131 |
| 双馆场 | 45 |
| 双馆且有 props 行 | 44 |
| **双馆同线**（`spreads\|line` / `totals\|line` 两侧皆有） | **9**（全部 `chi`） |
| `chi` | 11 场；双馆 9；**同线 9**；抽检 gap（双馆有 props 但无同线 / 有 props 但单馆）**0** |
| `mls` / `ucl` / `uel` | 双馆多，但同线 **0**（PF 无对应让球/大小 → 上游供给） |
| `uef` / `bra` / `mex` / `chi2` | 基本单馆并列 |

**检测宇宙（N4-detect）**：以 **中超 `chi` 双馆同线** 为主；不把 MLS/欧战「有双馆胜负但无线」当漏并。  
**已修**：`resolveFootballLeagueFromText` 对 `chi` 使用 unicode 词界，避免 `Chişinău` 误标中超（`sport_football_markets`）。  
**噪声**：偶发非中超场进列表（如过期缓存 `Yes vs No`）由检测过滤；不因此新建 matcher。

### 验收记录（2026-07-15）

| # | 结论 | 依据 |
|---|------|------|
| 1 Tab ≠ 套利 | 通过（代码） | `sportTab` 仅换板；`appSession.startAppSession` → `startMainLoop`，与 Tab 无关；板子 `v-if` + `stopPolling` |
| 2 磁盘缓存 | 通过 | `storage/sport/mlb|soccer/match_list.json` 存在 |
| 3 stale | 通过（代码） | `sport_gamma_fetch` Gamma 失败读 `readSportListCache` 返回 stale |
| 4 隔离 | 通过 | `npm run test:catalog-smoke` ok；`client_matches`/`@changmen/db` 仅拒绝路径与注释 |
| 5 PF 赔率解析 | 通过 | `sport_predictfun_fetch.smoke`：`{price,size}` + tip mid |
| 6 fo 边界 | 通过（代码） | `createSportListStore` 仅 Sources→fallback；无 `oddsStore.save` |

UI 点验（登录后切 Tab 看电竞循环仍转、足球 PM/OB 独立赔率）可按日常联调补勾。

### Predict.fun 只读并列（棒球/网球旧路径；足球已停）

- `Client_GetBaseballMatchs` / `GetTennisMatchs`：Polymarket Gamma + Predict.fun REST **先拉后合并**；`Client_GetFootballMatchs` 只返回 PM collector 快照，不请求 PF、不进 `sport_merge`
- 实现：[`sport_predictfun_fetch.js`](../server/backend/core/esport-api/sport_predictfun_fetch.js)；缓存 key `mlb_pf` / `soccer_pf` / `tennis_pf`
- 棒球联赛 Game：优先 category `teams[].league`（官方 required；`mlb`/`kbo`/`npb`），无则 title/tag 回退
- 需 `PREDICT_FUN_API_KEY`（backend `.env`）；**不必**启 `changmen-predictfun-collector`（那是电竞 RDS 入库）
- 本机直连 `api.predict.fun` 失败时走 `PREDICT_FUN_HTTP_RELAY_ORIGIN`（HK http-relay；与浏览器 PF transport 同思路）
- 官方形态：棒球多为 `SPORTS_TEAM_MATCH` 单盘双 outcome；足球多为 `SPORTS_MATCH`（见 [MarketVariant](https://dev.predict.fun/marketvariant-14037485d0)）
- 赔率：outcome.`bestAsk`/`bestBid` 为 `{ price, size }`（[Get markets](https://dev.predict.fun/get-markets-25326905e0)）；无价或空盘 → `Status=Locked`（队名仍显示，**不是**匹配失败）
- 前端：体育只读盘 **不写** `oddsStore` / fo。`ViewBetItem` 构造保持 [A8 可证实]（非 HG fallback=0）；`createSportListStore` 在转换后按 `Sources.*` 补 fallback（列表即快照，类比 HG 用 Sources 作展示源）
- 单侧失败：另一侧有数据仍成功；两侧皆失败才 `fail`
- `manifest.json` PredictFun **`bet: true`**（电竞 house）；**不开** sport 下注 / N4 / Team UI（与电竞 `getProvider` 门控分离）

---

## 2. 棒球 MVP（已落地）

| 做 | 不做 |
|----|------|
| `Client_GetBaseballMatchs` | 改 `Client_GetMatchs` |
| 服务端 Gamma MLB + Predict.fun → `sport_merge` | matcher / baseball profile / 下单 |
| UI：HomeView「棒球」Tab + `MatchCard` | 棒球套利 |
| `baseballStore` 独立轮询 | 独立棒球站；拆 users/orders |

```text
电竞（不动）
  GetMatchs → client_matches → matchStore → 电竞列表 / 电竞套利

棒球
  GetBaseballMatchs → (Gamma mlb+kbo+npb ∥ PredictFun mlb_pf) → baseballStore → 棒球 Tab
```

> PM Gamma：`mlb` series `3`、`kbo` `10370`、`npb` `11968`（勿用 `jap`——那是日职足球）。PF 棒球靠 tag Baseball(`143`)/MLB(`142`)，KBO 标题常带 `KBO:` 前缀。

### 协议

```text
POST /esport/Client_GetBaseballMatchs
→ { success: 1, info: ClientMatchDto[] }
```

| DTO 字段 | 来源 |
|----------|------|
| `Game` | `"mlb"` / `"kbo"` / `"npb"`（按联赛） |
| `Matchs.Polymarket` / `Matchs.PredictFun` | 各源 id（经 `sport_merge` 同场合并时同卡；对不上则各保留一场） |
| `Bets[0].Sources.*` | moneyline；`Type` = Polymarket 或 PredictFun |

### 前端

| 模块 | 路径 |
|------|------|
| API | `getBaseballMatchs()` → `api/match.ts` |
| Store | `stores/baseballStore.ts`（`createSportListStore`） |
| UI | `BaseballBoard.vue` + `MatchCard` |

---

## 3. 足球 MVP（只读，同模式）

| 做 | 不做 |
|----|------|
| `Client_GetFootballMatchs` | 改 GetMatchs / matcher |
| Gamma soccer 父 tag `100350`（全量足球，与 PM 官网同口径；未知联赛 `Game=unknown_fb`，原生联赛名经 DTO `League` 透传，前端按映射表显示中文名、未收录保留原文）+ Predict.fun → 合并 DTO | 套利 / 下单 / 进 `mainBetLoop` |
| 胜负 + 让球/大小（全量线） | 伪造 PF 未上架的盘 |
| HomeView「足球」Tab；联赛中文名 | 独立 `football/web` |

```text
POST /esport/Client_GetFootballMatchs
→ { success: 1, info: ClientMatchDto[] }
// Game = 联赛码（chi/mls/epl/…）；UI 显示 catalog 中文名
// Bets: moneyline + spreads/totals（MarketCode + Line）；按场馆 Sources 并列
```

| 模块 | 路径 |
|------|------|
| API | `getFootballMatchs()` → `api/match.ts`（仅 PM collector 快照；无 PF / `sport_merge`） |
| Store | `stores/footballStore.ts`（`createSportListStore`） |
| UI | `FootballBoard.vue` → `FootballMatchBoard`（OB 试玩实时：比分/盘口） |
| Manifest | `lines/football/` |
| 联赛名 | `packages/shared/catalog/game_catalog.json`（`sport: football`） |
| **OB 体育试玩机制** | [client/web/docs/platforms/OB_SPORT.md](../client/web/docs/platforms/OB_SPORT.md) |
| **场馆匹配** | [§3c](#3c-足球场馆独立列表与-pod-匹配2026-09-24) · `podVenueMatchPlugins.ts` |

## 3b. 网球 MVP（只读，同模式）

| 做 | 不做 |
|----|------|
| `Client_GetTennisMatchs` | 改 GetMatchs / matcher |
| Gamma ATP+WTA 单打 + Predict.fun → `sport_merge` | 双打 / ITF / 匹配 / 套利 / 下单 |
| HomeView「网球」Tab | 独立 `tennis/web` |

```text
POST /esport/Client_GetTennisMatchs
→ { success: 1, info: ClientMatchDto[] }  // Game: "tennis"
```

| 模块 | 路径 |
|------|------|
| API | `getTennisMatchs()` → `api/match.ts`（PM ∥ PF 经 `sport_merge`） |
| Store | `stores/tennisStore.ts`（`createSportListStore`） |
| UI | `TennisBoard.vue` → `SportMatchBoard` + `MatchCard` |
| Manifest | `lines/tennis/` |
| Gamma | `tennis_gamma_fetch.js`（`atp`/`wta`，series `10365`/`10366`，idBase PM `920_000_000` / PF `930_000_000`） |

## 3c. 足球场馆独立列表与 POD 匹配（2026-09-24）

OB 试玩数据留在浏览器；PM 官方可达时浏览器直拉，不可达时由 `changmen-pm-football-collector` 快照中转。两馆比赛在 `footballStore` 中只按时间排序并列，禁止 `mergeFootballClientLists`、overlay 或服务端足球 `sport_merge`。

POD 对每个场馆分别运行队名、开赛时间、联赛、主客朝向和盘口匹配：OB 只看带 `obMid` 的 fixture，PM 只看带 `pmMid` 的 fixture。确认依据使用当前场馆自己的 ID；两个场馆存在相同比赛时不会互相造成 `pending`。猜测身份仍不得自动下注。

足球 PM 列表窗口为开赛后 4h 至未来 6h。官方列表失败或为空时读取 VPS 快照；体育 Market WS 官方连接失败后独立切换 `PM-SPORT-MARKET`，不写电竞 PM source mode。

电竞身份不变量仍以 [MATCH_IDENTITY_MODEL.md](./MATCH_IDENTITY_MODEL.md) 为准；足球不得写 `client_matches`、电竞 `fo` 或进入 `mainBetLoop`。

## 3d. POD 足球场馆匹配插件（2026-09-24）

POD 警报与场馆比赛、盘口、报价的匹配统一经 `client/web/src/runtime/podVenueMatchPlugins.ts` 注册表调用。场馆插件负责 `matchFixture`、`matchMarket`、`compareQuote`；需要保留专用评分链路的场馆可额外实现 `scoreTicket`。新增场馆只注册新插件，不在 `PodFollowPanel.vue` 中继续增加场馆分支。

- **OB 兼容红线**：OB 插件先隔离 OB fixture，再委托既有 `matchPodAlertToFixtures`、`scorePodYaboFollow`，不复制或改写现有评分算法，保持当前 POD 警报 → OB 比赛/盘口、副盘与 NVP 行为。
- **PM 隔离**：Polymarket 插件生成自己的比赛和盘口匹配结果；PM 下单载荷不得借用 OB 的 fixture match。
- **电竞隔离**：插件层不得 import 电竞 `matchStore`、`oddsStore`、`mainBetLoop`，不得写 `fo` 或 `client_matches`；相关静态守卫位于 `sportOddsIsolation.test.ts`。

自动跟单的执行认领、重复下注保护、故障状态和部署顺序见 [POD_AUTO_FOLLOW.md](./POD_AUTO_FOLLOW.md)。

## 4. 验收

1. `Client_GetMatchs` 与改前一致。  
2. 登录后棒球 / 足球 / 网球 Tab 能列出对应场次。  
3. **关 Tab / 切到棒球足球网球不影响电竞套利循环**（Tab 与 mainBetLoop 解耦）。  
4. Gamma / series 失败时板子显示错误文案，而非假「暂无比赛」。  
5. 无 `npm run baseball:dev` / 无 `baseball/web` workspace。

---

## 5. 已交付 / 硬闸门之后

| 阶段 | 状态 | 隔离要点 |
|------|------|----------|
| **N3 moneyline 合并** | **已做**（请求路径 + `sport_*`；非独立 PM2 matcher） | 禁写电竞 `client_matches`；禁 import 电竞 `team_db`；仅双场馆对替换 API |
| **足球让球/大小只读** | **已做**（PM / OB 各馆独立供给） | 不改 `GetMatchs` / fo / `mainBetLoop` |
| **足球 POD 场馆插件** | **已做**（PM、OB 分别对场和对盘；网页不合场） | OB 继续委托原 `scorePodYaboFollow`；新增场馆只注册插件 |
| **N4 套利环** | **未开** — 要自动下单再单开 plan | 新建 sport loop，**禁止**进 `mainBetLoop`；棒球主盘 moneyline，足球主盘 **让球+大小球**（胜负不作套利主盘） |
| **Sport Team UI / PF 下注** | **未开** | — |

### N3 schema（已建 · 接线见下节）

Migration：[`033_sport_matcher_tables.sql`](../server/backend/db/migrations/033_sport_matcher_tables.sql)（`apply-rds-schema` 已挂）。  
Store：`rds/rds/sport_{client_matches,venue,team}_store.js`；隔离 smoke：`npm run test:catalog-smoke` 含 `sport_matcher_tables.smoke`。

| 表 | 角色 |
|----|------|
| `sport_client_matches` (+ history) | 合并输出；棒/足同表，`sport` 列区分 |
| `sport_venue_matches` / `sport_venue_bets` | 场馆原始；列名 **`venue`**（非 platform）；bets 预留 `market_code`/`line` |
| `sport_canonical_teams` / `sport_team_venue_maps` | 体育队名（手动 gb 从 200000）；与电竞队名表隔离 |
| `sport_client_match_venue_overrides` | 场馆主客 force_aligned / force_reversed |

**仍不做：** Team UI 拖线、PredictFun 下注、N4 套利环。只读 JSON 仍作 API fallback。

### N3 接线（已做 · 电竞零交叉）

| 步骤 | 状态 |
|------|------|
| 033 表 + store | 已做 |
| 摄入 `sport_venue_*` | `sport_venue_ingest` + Get* 路径；落库 **异步**（不阻塞 API） |
| moneyline 合并 → `sport_client_matches` | `sport_merge.js`（当次列表内存合并；**仅双场馆对**替换 API；1h 窗） |
| MLB 队名别名 | `@changmen/team-resolver/sport_team_plugin` + `sport_mlb_aliases.json`（如 A's→athletics）；不读电竞 `team_db` |
| `GetBaseball/FootballMatchs` | `multiVenueCount>0` 返回合并列表，否则 **fallback** 原 concat |
| `Client_GetMatchs` / `buildMatchList` | **不动** |

隔离：`sport_merge` / `sport_*_store` / plugin 不得写 `client_matches`、不得 import 电竞 `team_db`；体育板不 seed fo。

### N3.5 体育赔率实时显示（已做 · 独立 sportQuoteHub · 仍禁 N4）

棒/足等体育页打开时，PM 走 **独立** `sportQuoteHub` + `changmen-pm-sport-market-hub`（`:3459` / `PM-SPORT-MARKET`），与电竞 `marketQuoteHub` / `:3457` **分进程、分上游、分浏览器 WS**：

| 做 | 不做 |
|----|------|
| PM CLOB（体育 hub）+ PF orderbook → `sportOddsStore` → `fallback*Odds` | 写电竞 `oddsStore`(fo) / `saveVenueOdds` |
| 订阅窗 = 过去 6h + 未来 1h；体育 token 硬顶 **100** | 往电竞 `marketQuoteHub` register `"sport"` |
| 关体育 Tab → `clearPolymarketSportHub` 停体育 transport | 触碰电竞 `activeMarketWsHandle` |

PF 仍可暂共用电竞侧 hub（后续再拆）；PM 已完全隔离。

分层：

- **电竞数据源** `marketQuoteHub`：连 `PM-MARKET`、合并电竞消费者、广播 quote → fo
- **体育数据源** `sportQuoteHub`：连 `PM-SPORT-MARKET`、独立 WS → `sportOddsStore`
- **电竞** collector：`register("esport")` → 写 fo；**stop 只 unregister esport**
- **体育** `sportLiveOdds`：`setPolymarketSportAssetIds` → `sportOddsStore`；关 Tab 才 `clearPolymarketSportHub`

**生命周期契约测（合并闸门，改 hub/collect/ws 前必绿）**：

```bat
cd packages\venue-adapter
npm run test:quote-hub-contracts
```

| 契约 | 文件 |
|------|------|
| stop 边界 / force 重订 / late-join / fo 过滤 | `*/marketQuoteHub.lifecycle.test.ts` |
| PM 体育独立 WS / 不 import marketQuoteHub | `polymarket/sportQuoteHub.test.ts` + lifecycle source |
| PF unsubscribe 差额 | `predictfun/marketQuoteHub.lifecycle.test.ts` |
| collect 源码：`sync*(true)`、重建 maps、不 clear sport | lifecycle 内 source contracts |
| 电竞板可下注 / 体育只读 / sportLiveOdds 不写 fo | `marketQuoteHub.contracts.test.ts` |

### 电竞业务冻结（后续体育迭代不改电竞实现）

PM 体育与电竞 **分 hub**；为避免体育 PR 再「顺手动电竞」：

| 面 | 规则 |
|----|------|
| **冻结** | 清单 [`packages/venue-adapter/esport-freeze.json`](../packages/venue-adapter/esport-freeze.json)：PM/PF `collect`、fo/`oddsStore`/`mainBetLoop`、PM 下注结算栈等 |
| **可改** | `marketQuoteHub` / `sportQuoteHub` / `ws*`、`sportLiveOdds`、`sportOddsStore`、`SportMatchBoard*` |
| **闸门** | `npm run check:esport-freeze --workspace=@changmen/venue-adapter`（已挂 `check:venue-adapter`） |
| **解冻** | `ALLOW_ESPORT_TOUCH=1` 或 `npm run check:esport-freeze:allow`；改 hub/collect 后仍须绿 `test:quote-hub-contracts` |

体育/N3.5 迭代默认 **不要** 改冻结面文件；CI / 本地碰到 diff 踩冻结面会失败。

| 模块 | 路径 |
|------|------|
| 电竞 Hub | `venue-adapter/{polymarket,predictfun}/marketQuoteHub.ts` |
| 体育 Hub | `.../sportQuoteHub.ts`（PM 独立 WS；PF 仍薄封装 register） |
| 会话 | `client/web/src/runtime/sportLiveOdds.ts` |
| Store | `stores/sportOddsStore.ts`（与 fo 隔离） |

PF：`Sources.HomeMarketID/AwayMarketID`（`sport_predictfun_fetch` + `sport_merge` 保留）；单盘双 outcome（同 marketId）仍靠列表轮询，不做分边猜价。

维护硬化（P2）：

- hub `(re)start` → `on*MarketHubReady` / `on*SportHubBound` → 板子 `sync(true)`
- 关 Tab：`sportOdds.clear()` + 清空体育订阅
- `SportMatchBoard`：`allow-betting=false`，禁双击 `manualBet` / EV / target / 补单
- PF 仅订 `HomeMarketID/AwayMarketID`；缺字段或单盘同 marketId **不订**（防 onChainId 占硬顶）

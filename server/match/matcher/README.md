# server/match/matcher — 赛事合并运行时

`@changmen/matcher`：合场算法（`compose/`）、调度循环、人工关联 Web 面板。

matchMerge 循环**内嵌在 `changmen-esport`**（`npm run web` / PM2 `changmen-esport`），本目录提供合并库、运维 API 与可选人工 UI。

matcher 页面按这一套 composer 合场链路展示状态、最近合场时间和“立即合场”；人工关联也调用同一个 composer。页面不再提供启停循环按钮、重复的写路径标签或独立 Composer 对照入口。下文独立 UI、对照和试算命令是开发工具，不是另一套生产合场进程。

## 目录

| 目录 | 内容 |
|------|------|
| `compose/` | 合场算法：聚类、ID 绑定、主客锁/投影、live 形状、写库 |
| `ops/` | 运维动作：align、backfill、auto_register_teams、快照缓存、单次 matchMerge |
| `link/` | 人工关联 API |
| `ui/` | 人工关联面板（4567 / 同源 `/matcher`） |
| `ui/compare/` | 只读对照页（4568）：左 RDS / 右纯场馆模拟 |
| `lib/` | 配置、env、心跳、写库互斥守卫 |

## 入口

| 入口 | 命令 | 端口 | 作用 |
|------|------|------|------|
| **内嵌合并循环** | `npm run web`（backend 启动时自动） | 无独立端口 | 每 30s（`MATCHER_INTERVAL_MS`）matchMerge + 每小时 client_matches archive |
| **人工 UI** | `npm run matcher:ui` → backend `scripts/matcher-ui.mjs` → `ui/server.js` | `4567`（`MATCHER_UI_PORT`） | 装配鉴权及采集端口后启动；**非生产必需** |
| **主站桥接** | 随 `npm run web` | 同源 `/matcher/`、`/matcher/api/*` | backend `http_bridge.js` 把 API 转给 matcher Express |
| **对照页** | `npm run composer:ui` → `ui/compare/server.js` | `4568`（`COMPOSER_UI_PORT`） | 左 RDS `client_matches` / 右 `fromVenuesOnly` 模拟；**禁止写库** |
| **独立合场循环** | `npm run composer:start` → `compose/loop.js` | 无 | 默认 dry-run，WRITE 会被互斥守卫拒绝 |

间隔、端口等环境变量由 `lib/config.js` 统一读取（勿在多处写 `process.env.MATCHER_*`）。

`lib/env.js` 优先包内 `.env`，`lib/env_composer.js` 优先 `server/backend/.env`。合并两者属行为变更，需单独评估。

## 合场管线

```
platform_matches / bets / timers / client_matches / overrides
  → clusterByGbThenName（自研）
    → resolveIds（match-identity/ids）
    → resolveMatchStructure（Round / gate / BO / periods / decider）
      → orientationLock（PM→OB→RAY）
        → projectSources（I1 / force_aligned / 决胜局用 Map0 作输入）
          → liveShape（trim / strip / 命名 / 排序）
            → writeClientMatches（仅 embedded viaMatcherWriter，或 FORCE 应急写）
```

赛制层（`compose/structure/`）必须跑在投影之前：`Round`、`BO`、该场的局段集合 `periods` 在此定型，投影与 shape 只读。决胜局（`Round === OB.BO`）缺原生局盘时，用 Map0 的 native 作为投影**输入**，因此只 swap 一次；shape 层不得回头改已投影的 `Sources`。不变式 `checkBetsWithinPeriods` 守这条。

生产自动合场写路径是内嵌 `matchMergeOnce` → `composeOnce`；PM2 不注册独立 composer 写进程。人工运维及 PM 附加字段写入另有各自入口。

[changmen 扩展] 2026-10-25：匹配关系与比赛状态分开。自动或人工结束已有比赛只写 `ended_at`，保留原 `matchs`、方向、盘口和平台 `match_id`，不隐式解绑。结束来源按平台场次 ID 跳过合场和待办，原始采集快照不变；旧反向指针已被清空的来源也按历史 `matchs` 识别。恢复展示清除 `ended_at` 后原关联重新可用，同队下一场的新平台 ID 不受影响。

PM 赛事身份匹配、已到开赛时间且明确结束时，整场结束，不等待其它平台的 Round、计时或锁盘；已有比赛即使本轮没合出来也检查 PM 终态。未关联 PM 的比赛沿用原结束规则。平台原始数据保留供“已结束”详情诊断。

同进程的合场写入、自动过期处理与人工结束/恢复串行，防止旧快照在状态操作后覆盖匹配字段。恢复或纠正后的当前活跃归属优先于重复历史记录；原有跨进程单写者守卫保持生效。

## 依赖

- `packages/match-identity`（`@changmen/match-identity`）— 队名、时间窗与 client_match ID 共享工具
- `server/db` — 读写 `platform_matches` / `client_matches` 等（`@changmen/db`）
- `server/match/resolver`（`@changmen/team-resolver`）— 可选队名 canonical 插件

matcher 源码不导入 backend。backend 经 `runtime_ports.js` 注入采集热快照、提交发布、人工结束缓存移除及鉴权；缺少宿主鉴权时拒绝访问。
独立 compose 只使用 DB，不会为读取或写后通知隐式加载 backend store。

backend 列表与 matcher 面板共用 DB 包的活跃列表快照缓存。行与版本在同一 SQL 语句中读取，版本覆盖人工修改及 PM 附加状态；失效会阻止在途旧读取发布。
合场的身份和 align 则复用一次含 ended 行的完整生命周期快照，保留 gb 锁与 PM 状态。
这些内部快照字段不进入 `Client_*` 线协议。

[changmen 扩展] matcher 已合场及已结束卡片展示 PM 比赛状态，读取 VPS `changmen-pm-sports` 保存的 `client_matches.pm_sport`，沿用用户页的状态文案（地图、整场比分和计时）。PM 关联缺少状态时显示“状态待更新”，不按开赛时间推断。卡片悬停提示快照更新时间；刷新沿用面板现有轮询。状态展示不另行计算比赛有效性；结束处理由上文 matcher 生命周期规则执行。

[changmen 扩展] 2026-10-25：composer 直接更新 `client_matches` 原有比赛、盘口与方向字段，不增加比赛副本或展示状态。已有单馆比赛继续刷新，缺席场馆保留盘口 ID 和关联，输出 `Locked`、零赔率和空选项 ID，复用 A8 前端锁盘；来源恢复后重新输出原生选项。全部来源缺席但尚未结束时仍保留比赛并锁盘，是否结束沿用 changmen 原有规则，已结束赛事不下发。两端共用 RDS 快照，页面不再二次判断两馆门槛或来源存活；PM 独立状态和既有 RAY 风险保护保留。数据同事务提交后再失效缓存。

[changmen 扩展] 篮球 `basketball` 使用原至少两馆的新比赛合场门槛，不再为未匹配来源单独成场；已撤销篮球单馆原生盘口投影与用户接口额外过滤。单馆例外生成的七条历史测试合场 `8746–8752` 由独立维护入口清理，仅删除合场行并解除挂载，保留 PM 来源和盘口，后续按原规则匹配。matcher 产出合场结果，用户接口按原读取流程消费，不再次判断篮球场馆数量。其他游戏的已有比赛保留、方向和结束规则不变。用户数值 `GameID=10001` 为 changmen 扩展。

已撤销的 `current_result` 字段由 `node rds/maintenance/drop-client-match-current-result.mjs` 独立维护，默认只读核验，`--apply` 执行删除；不进入部署或启动。运行时直接读取原有比赛字段，必需输入读取失败中止本轮。详见[统一产出方案及当前验收状态](../../../docs/MATCH_PUBLICATION_CONSISTENCY_PLAN.md)。历史取证见[审计报告](../../../docs/audits/MATCH_PUBLICATION_CONSISTENCY_AUDIT_20261019.md)。

环境变量：与 backend 共用 `server/backend/.env`（或本目录 `.env`）。`CHANGMEN_DB_SCRIPT` 与 backend 保持一致（兼容 `GAMEBET_DB_SCRIPT`）。

## 常用命令

```bash
cd changmen
npm run web             # backend + 内嵌 matchMerge 循环
npm run matcher:ui      # 人工关联 UI http://localhost:4567
npm run composer:ui     # 对照页 http://localhost:4568
npm run composer:once   # 干跑一次合场（默认不写库）
npm run composer:diff   # vs 当前 RDS
npm run composer:start  # 独立合场循环（默认不写库）
npm run composer:test   # 单测 + 禁止 merge import
```

`composer:once -- --write` 独立写库默认被拒；停掉 esport 后仅可用 `MATCH_COMPOSER_FORCE_WRITE=1` 应急。

心跳文件：`server/match/matcher/.matcher-heartbeat.json`、`.composer-heartbeat.json`（gitignore）。

## 数据边界（Client_GetMatchs vs matchMerge）

| 路径 | 职责 | 允许的操作 |
|------|------|------------|
| **matchMerge**（本目录调度 + `compose/`） | 读 `platform_matches` / `platform_bets` / `live_timers` → 写 `client_matches` | 聚类、Reverse/主客投影、决胜局 promote、Map=0 trim、Round、gb 锁 |
| **Client_GetMatchs**（`server/backend`） | 读 `client_matches` 返回前端 | **只消费**，不做 Bets/Sources/Reverse/Round 二次变换 |

自动合场写库统一走 `matchMergeOnce` → `composeOnce`。

### 主客朝向（gb 锁）

锚点链定初值：**Polymarket → OB → RAY**（第一个双侧 `gb_team_id` 已映射平台的 native 主客槽位）。无锚点平台时回落 min/max 投票。已写入的 `home_gb_team_id` / `away_gb_team_id` **永不自动翻转**。不提供整场比赛的人工主客对调；平台盘口仍按各平台相对该主客方向投影。

`Client_GetMatchs` 只读 `client_matches`。`SaveLiveTimer` debounce 触发 matchMerge（`MATCHER_TIMER_DEBOUNCE_MS`，默认 3s），常规循环由 `MATCHER_INTERVAL_MS` 驱动。

```bash
# 巡检 client_matches vs platform_bets / matchMerge 预览
node server/match/matcher/scripts/audit-client-sources.mjs
node server/match/matcher/scripts/audit-client-sources.mjs --quick
node server/match/matcher/scripts/audit-client-sources.mjs --strict
```

matchMerge 诊断日志：`MATCHER_MERGE_DIAG=1`。

更多：[../../../docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md)、[../../../scripts/README.md](../../../scripts/README.md)。

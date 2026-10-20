# Architecture Truth Audit — Changmen

- 审计日期：2026-09-19
- 审计对象：仓库当前 HEAD（工作区未提交文件仅作参考，不作为真相源）
- 产物：`docs/ARCHITECTURE_TRUTH_AUDIT.md`（本文件）+ `.ai/architecture/index.json` + `.ai/architecture/build-index.mjs`
- 性质：**审计报告**。除上述三个新建文件与 `docs/README.md` 索引行外，未改动任何代码、配置、文档。

> 2026-09-20 后续裁决：`CLAUDE.md` 已修正 F-01 的账号存储模型、F-12 中 `CLAUDE.md` 侧的 legacy storage 路径表述，并补充 F-15 的 `esport-freeze` 闸门说明。本报告其余冲突记录仍保留为 2026-09-19 审计快照，未在本次统一重扫。

## 0. 范围、方法与证据优先级

**方法**：五路并行取证（文档源盘点 / State Ownership 代码验证 / Registry 盘点 / Runtime+Boundary+Check 盘点 / Workspace 清单与依赖图），全部结论要求 file:line 级证据；关键数字（action 数、freeze 路径数、workspaces 解析、PM2 默认启动集）由脚本机械复算。

**证据优先级**（本报告全程适用；冲突判定以高优先级为准）：

1. 实际 executable code / config
2. machine-readable registry / config
3. automated tests / checks
4. architecture docs
5. README / comments
6. AI inference（本审计中的任何推断均显式标注）

**事实 vs 建议**：§1–§12 与附录为「已有事实」；§13–§15 为「建议」，已明确标注，不得当作当前架构事实引用。

---

## 1. Executive Summary

**一句话结论**：Changmen 的架构真相**执行层相当扎实**（4 个真正的机器可读 registry + 10 道自动化边界/契约检查 + 清晰的进程清单），但**真相分散在 20+ 份文档与 9 处平台清单副本中，存在 15 处文档漂移/冲突、若干「单写者」过度宣称，以及 2 个尚未文档化的机器闸门**。最小 Architecture Index 已作为原型落地（§13），全部条目可由现有仓库事实派生。

**关键数字**：21 个 workspace 包（18 条 glob 声明）｜9 个 PM2 app + 1 个手动 daemon｜104 个 HTTP action（+10 核心集成 action 为其子集）｜17 个平台（manifest 为源，另有 8 处副本）｜5 条产品线 line.json｜14 项重点状态已建 ownership 矩阵｜15 处冲突/漂移（全部需人工裁决，无一自动「修正」）。

**A–J 速答**（详细论证见附录）：

| # | 问题 | 速答 |
|---|------|------|
| A | 已有哪些 Architecture Truth？ | 4 个 canonical registry（CHANGMEN_LAYOUT、manifest.json、catalog JSON、api-contract actions）+ PM2 manifest + 10 道自动检查 + 20+ 份文档（§2） |
| B | 哪些真正 canonical？ | 被代码消费且有校验的 4+2 个（§2、§8）；`client_matches` 自动写路径、`players` 账号模型等以代码为准 |
| C | 哪些只是 documentation？ | PATH_REGISTRY.md（手工镜像）、lines/line.json（零代码消费）、DB 读写矩阵、adapter ABI（§8、§11） |
| D | 哪些可自动生成？ | modules/runtimes/lines/contracts 名册、平台清单副本 drift 检测、PM2 三处副本对账（§13） |
| E | 哪些重复？ | 平台清单 ×9、PM2 名 ×3、linePath ×2、CHANGMEN_LAYOUT↔PATH_REGISTRY.md、action 名 twin、账号存储模型 ×2（§9） |
| F | 哪些冲突？ | 15 处，全部登记于 §10，均标 `requires_human_decision` |
| G | 哪些 State Ownership 未机器化？ | 全部 14 项状态的所有权目前只在散文文档/代码里，无 machine-readable registry（§3、§11） |
| H | 哪些 Runtime Ownership 未机器化？ | runtime→capability→state 映射无 registry；ecosystem 只到进程级；capabilities 靠代码取证拼出（§4、§11） |
| I | Index 最小 schema？ | `sources/modules/capabilities/states/contracts/runtimes/lines/rules` 八节 + 每条目 `source/evidence/status`（§13） |
| J | 下一步是否值得做 Context Resolver？ | 值得，但**在冲突仲裁之后**；先消 §10 的 15 处 `conflicted`，否则 Resolver 会把歧义固化（§15） |

---

## 2. Existing Truth Inventory

「canonical?」= 是否被代码实际消费且为源；「verified?」= 有无自动校验。

| source | truth type | canonical? | machine-readable? | verified? | consumers |
|---|---|---|---|---|---|
| `server/storage/paths.js`（CHANGMEN_LAYOUT） | registry（布局/路径） | ✅ 源 | ✅ JS 常量 | ✅ `paths_smoke.test.mjs`（经 catalog-smoke 链） | check-team-boundaries、venue-adapter loader、`client/web/vite.config.ts:18,217`、platform-probes、backend storage_paths |
| `packages/venue-adapter/registry/manifest.json` | registry（17 平台能力开关） | ✅ 源 | ✅ JSON | ⚠️ 部分（DEV 自检 warn 非 CI + `meta.browserSave.test.ts`） | adapters.ts / meta.ts / feeds.js / backend `registry/feeds.js` / icon 生成 |
| `packages/shared/catalog/*.json` | registry（sport/game/market catalog） | ✅ 源 | ✅ JSON | ✅ 3 个 smoke test，在 `npm test` 链 | 60+ 文件（backend/matcher/venue-adapter/web/probes） |
| `packages/api-contract/src/actions.ts` | registry + contract（104 actions） | ✅ 源 | ✅ TS | ✅ `urls.test.mjs` + `action_registry.test.mjs` | 前端 `api/client.ts`、后端 `action_registry.ts:8`、router |
| `packages/venue-adapter/esport-freeze.json` | registry（22 条冻结路径） | ✅ 源 | ✅ JSON | ✅ `check-esport-freeze.mjs`（git gate） | check:venue-adapter 第 4 环；**文档零记载** |
| `deploy/ecosystem.config.cjs` | registry（9 个 PM2 app） | ✅ 源（进程级） | ✅ CJS | ❌ 无自动校验 | PM2、`deploy/scripts/*.sh`；**Node 代码不读** |
| 根 `package.json` workspaces | registry（18 条 glob → 21 包） | ✅ 源 | ✅ JSON | ✅ npm/turbo 解析 | npm、turbo |
| 各 workspace `package.json` | registry（包名/依赖） | ✅ 源 | ✅ JSON | ⚠️ 无 drift 校验 | npm、turbo、所有包 |
| `scripts/check-team-boundaries.mjs` | executable boundary（6 组 RULES :20-95） | ✅ | — | 自身即校验 | 根 `npm test` 第 1 环 |
| venue-adapter 3 道 check（exports/internal/web-imports） | executable boundary | ✅ | — | 自身即校验 | `check:venue-adapter` |
| client-core 3 道 check | executable boundary | ✅ | — | 自身即校验 | `check:client-core` |
| `check-esport-freeze.mjs` | executable gate | ✅ | — | 自身即校验 | `check:venue-adapter` 第 4 环 |
| `scripts/catalog-smoke.mjs`（20 步）+ `check-no-merge-import.mjs` | executable verification | ✅ | — | 自身即校验 | `npm test` 链 / matcher test |
| `audit-client-sources.mjs` | executable 巡检 | ✅ | — | 手动（**不在** npm test 链） | `npm run audit:client-sources` |
| `docs/TEAM_BOUNDARIES.md` | 边界/所有权文档 | 文档（与脚本基本对齐） | ❌ | 由 check-team-boundaries 近似覆盖 | 人、AI |
| `docs/DATA_STORAGE.md` | state ownership + API 数据策略 | 文档（§10 列 3 处矛盾） | ❌ | ❌ | 人、AI |
| `docs/PATH_REGISTRY.md` | 布局文档 | ❌ **手工镜像**（自我承认双登记） | ❌ | ❌ | 人、AI |
| `docs/CATALOG.md`、`docs/SPORTS_PRODUCT_LINES.md`、`ARB_MULTI_SPORT.md` | catalog/产品线叙事 | 文档（ARB_MULTI_SPORT 为多运动上位源） | ❌ | 部分（catalog smoke 验 JSON 不验叙事） | 人、AI |
| `PRODUCTION_DEPLOYMENT.md` | runtime 拓扑/冻结令 | 文档（与 ecosystem/deploy.sh 核对一致） | ❌ | ❌ | 人、AI |
| `CLAUDE.md`、`readme.md`、`docs/README.md`、`server/README.md`、`LOCAL_DEV.md` | 命令/共识/索引 | 文档（§10 列 2 处陈旧） | ❌ | ❌ | 人、AI |
| `lines/*/line.json`（5 条） | 产品线锚点 manifest | ⚠️ 机器可读但**零运行时代码消费** | ✅ JSON | ❌ 无校验 | 仅文档引用 |
| `.github/CODEOWNERS` | 所有权 | ❌ **不存在**（仅过时模板 `docs/CODEOWNERS.example`） | — | — | — |

---

## 3. State Ownership Matrix

全部结论来自代码取证（writer 均给到 file:line）。`memory-first?` 指该路径是否允许异步丢弃。「文档」列给出 DATA_STORAGE 等对应条目；标注 ⚠️ 的见 §10。

| 状态 | 谁写（代码证据） | single writer? | 写入 runtime | 持久化 | memory-first / 可丢? | 文档 |
|---|---|---|---|---|---|---|
| `platform_matches` | ①浏览器路径：`router.ts:557` → `store.js:204`→`:264` `sb.writePlatformMatches`；②`polymarket-esports/loop.js:66-69`；③`predictfun-collector/loop.js:118,127,129`；④`sxbet-collector/loop.js:74,84,85`；⑤prune `platform_collector_store.js:740` | **否（刻意多写者，按 platform 前缀分行）**；浏览器路径对 VPS 馆被 `isVpsOwnedPlatformCollect` 软守卫拦截（`store.js:208/317/345`，仅 warn+return） | `changmen-esport` + 3 collector 进程（2  paused） | RDS `platform_matches`（孤儿行搬 `platform_matches_history`，`:115-120`） | 浏览器路径**是**（内存先写 + `_writeRds` fire-and-forget，队列满 drop `common.js:71-103`）；collector 路径否（await） | DATA_STORAGE:9 |
| `platform_bets` | ①`router.ts:567` → `store.js:313`→`:337`；②③④ 同上 collectors | 否（同上） | 同上 | RDS `platform_bets`（每 match full replace；sticky 平台空快照不清 `:15,38`） | 同 platform_matches | DATA_STORAGE:10 |
| `live_timers` | `router.ts:577` → `store.js:340` → `platform_collector_store.js:1119 writeLiveTimersAsync`（**await**） | **是**（每平台全量替换语义；OB 空响应防 wipe 特例 `store.js:351-372`） | `changmen-esport` | RDS `live_timers` | 否（该路径 await；内存 `_timers` 先更新 `:373`） | DATA_STORAGE:11 |
| `client_matches` | **自动循环唯一活路径**：`match_merge_once.js:116` → `compose_once.js:144` → `compose/io/write.js:16` → `client_matches_store.js:280`（await 直写）。例外：①`pm_sport` 列 ← `changmen-pm-sports`（`pm_sport_store.js:74`）；②matcher UI/ops 人工写（`matcher_store.js:192,225,462,497,557`）；③死代码 `core/db/store.js:358 saveClientMatches`（无调用方） | **partial**：自动循环写唯一（互斥 = 本地 pid 心跳 `write_guard.js:41-50`，非 DB 锁）；表级非单写者 | `changmen-esport`（compose）；`changmen-pm-sports`（列） | RDS `client_matches`；history 表存在（`014_history_tables.sql:5`）；`archive_stale.js` 默认 client scope = **no-op**（`:117`），ALL scope 才搬 history | 否（Async 直写；无 pool 降级 fire-and-forget `:286`） | DATA_STORAGE:12 声称单写路径；⚠️ matcher `README.md:47`「生产唯一 writer」为 overclaim（§10 F-02） |
| `orders` | `order_store.js:161 saveOrder` → `orders_store.js:224 upsertOrders`；`updateOrderBind:1178`/`rebindOrderLink:1229`；PF 集成 `pf_server_order.js:17`；admin 删除 `orders_store.js:1020,1045`；ops 迁移脚本 | 否（多入口，行级 upsert 以 (player, orderId) 为键；`saveOrder` 前置 strict 读防覆盖 `:191-194`） | `changmen-esport` + ops 脚本（离线） | RDS `orders`（migration 001:38） | 否（全 await） | DATA_STORAGE:18（仅电竞） |
| `football_orders` | `football_order_service.js:41` → `football_orders_store.js:81 upsertFootballOrder`（ON CONFLICT (user_id, client_id)）；结算回写 `:166`（入口 `football_order_routes.js:30`） | 否（用户 API + 结算回写） | `changmen-esport` | RDS `football_orders`（migration 040/041；DDL 亦内联 `:7-46`） | 否 | DATA_STORAGE:19 |
| `platforms.json` | `platform_storage.js:13 setPlatform`（**同步**落盘）；写者：`server.js:92-120` platform_sync 启动种子、`router.ts:548-554 API_UpdatePlatform`、`router.ts:498` TF 探针 | 是（名义单写者**进程**；文件级无锁） | `changmen-esport` | 本地文件 `ESPORT_DATA_DIR/platforms.json`；默认 `ESPORT_DATA_DIR = STORAGE_DIR = env(CHANGMEN_STORAGE_DIR‖GAMEBET_STORAGE_DIR) ‖ server/backend/storage`（`paths.js:44-49`） | 否（同步） | DATA_STORAGE:30,79；⚠️ 与 CLAUDE.md `storage/legacy/esport` 表述漂移（§10 F-15） |
| esport 热缓存 `_matches/_bets/_timers` | `store.js:204/313/340`；`:512 hydrateCollectorHotSnapshot`；`:272 patchCollectorMatchClientIds` | 是（进程内） | `changmen-esport` | **仅内存**（`store.js:54` 注释：已替代三个 JSON 文件）；重启从 RDS 回灌（`server.js:144-161`） | 是（可重建） | DATA_STORAGE:37 |
| `profiles`/`players` 内存镜像 `_cache`/`_accountsCache` | `core/db/store.js:12`（`pullProfilesFromDb:118` 启动全量；`upsertProfile:74`；`replaceAccountsForUser:205`） | 是（进程内） | `changmen-esport` | 内存镜像 + 写穿透 `sb.writeProfileAsync`，失败 `_restoreRow` 回滚（`:20-26,100-106`） | 否（写穿透+回滚） | ⚠️ ACCOUNT_BACKEND（players 唯一真相）vs CLAUDE.md:163,268（profiles.accounts jsonb）冲突（§10 F-01） |
| `_clientMatches` 内存缓存 | `core/db/store.js:310`（`setClientMatchesFromMatchMerge:408`；RDS 回源 `_applyClientMatchRows:329`） | 是（进程内） | `changmen-esport` | 内存镜像 RDS `client_matches`；built_at 签名键 `:312-322`；`MATCHES_CACHE_MAX_AGE_MS=90s` 兜底 `:315` | 是（可重建） | DATA_STORAGE:37 |
| `client_matches.pm_sport` 列 | `collectors/polymarket-sports/index.js:37` → `pm_sport_store.js:74 updateClientMatchPmSport` | 是（该列） | `changmen-pm-sports` | RDS 列（migration 016） | 否 | **文档未单列该列写者**（§11 M-06）；读者：matcher ended_filter、hub `pushPmSportToBrowsers` |
| market index JSON ×3 | 各 collector `market_index.js` → `server/storage/{polymarket,predictfun,sxbet}_market_index.js`（同步写） | 是（每文件单 collector） | 3 collector 进程（2 paused） | 本地 `ESPORT_DATA_DIR/*.json` | 否 | DATA_STORAGE:31（未含 sxbet 专条） |
| `sport_client_matches`（+history +venue_overrides） | `sport_merge.js:534` → `sport_client_matches_store.js:49 replaceSportClientMatches`（ON CONFLICT upsert + 旧行搬 history `:115`）；override `:144` | 是（由 GetBaseball/Football/Tennis/Basketball 请求在进程内触发） | `changmen-esport` | RDS（migration 033） | 否 | ⚠️ DATA_STORAGE:14 vs :81 自相矛盾（§10 F-03） |
| `value_signals` | `server/value-bet/db/signal_store.js:17,63,111` | 是 | `value-bet`（手动，不在 PM2） | RDS | 否 | 无专条文档（§11） |
| `default_odds.json` | `store.js:62-64` → `json_file_store.js:32 writeJsonFileDebounced`（5s） | 是 | `changmen-esport` | 本地 JSON | **是**（debounce 合并，崩溃可丢 5s 窗口） | — |

**单实例约束的总根源**（代码+配置双证）：memory-first 主工作集（上述进程内缓存）+ `platforms.json` 本机文件 → `deploy/ecosystem.config.cjs` 注释「勿 instances/cluster」+ `docs/DATA_STORAGE.md:150` 单实例冻结。

---

## 4. Runtime Ownership Matrix

来源：`deploy/ecosystem.config.cjs`（9 app）+ `deploy/scripts/deploy-server-remote.sh`（默认启动集/暂停集，生成器已机械解析）+ 入口脚本头部代码取证。**runtime ≠ capability**：下表「承载 capabilities」逐项有代码证据。

| PM2 runtime | 入口（file:line） | 端口 | 承载 capabilities（证据） | 写的状态 | 单实例? | 默认启动 |
|---|---|---|---|---|---|---|
| `changmen-esport` | `server/backend/scripts/start-db.mjs:29` → `server.js` | `PORT`（linux 默认 3456，`server.js:41-43`） | ① esport HTTP action API（`server.js:65-70`→`http_routes.js:11`）② 5 个 HTTP 代理（`http_routes.js:21-25,374-382`）③ 静态托管 `/`、`/matcher/`、`/esport2/`（`server.js:30-38,59-63`）④ ws_forward engine（`server.js:85`；默认平台 IA/OB/RAY/PM-USER `:72`）⑤ realtime-hub Socket.IO（`server.js:90`）⑥ matcher 面板 bridge（`http_routes.js:49-56`）⑦ 内嵌 matchMerge 循环（`server.js:163-175,265`）⑧ platform_sync 凭证种子（`server.js:92-120`）⑨ market-index sync 子进程 spawn（`server.js:192-217`，默认仅 PORT=3700 本机 dev）⑩ account/admin 种子（`server.js:249-256`） | `client_matches`（compose）；浏览器 Save* 镜像 `platform_*`/`live_timers`；`players/profiles` 种子；matcher heartbeat 文件 | **冻结单实例**（ecosystem 注释；memory-first + platforms.json） | ✅ |
| `changmen-pm-market-hub` | `ws_forward/pm_market_hub_server.js:29-44` | 3457 | WS hub；上游 `wss://…clob.polymarket.com/ws/market`（`platforms/pm.js:3`）；health + 连接归因 | 无 DB 写 | 无（独立进程即隔离扇出） | ✅ |
| `changmen-pm-sport-market-hub` | `pm_sport_market_hub_server.js` | 3459 | 同上（`core/pm_sport_market_hub.js`，注释声明与电竞隔离副本） | 无 DB 写 | 无 | ✅ |
| `changmen-predictfun-market-hub` | `predictfun_market_hub_server.js` | 3458 | WS hub；上游 `wss://ws.predict.fun/ws`（`platforms/predictfun.js:3`） | 无 DB 写 | 无 | ✅ |
| `changmen-sxbet-market-hub` | `sxbet_market_hub_server.js` | 3460 | WS hub；上游 Centrifugo `wss://realtime.sx.bet/…`（`platforms/sxbet.js:4,20-24`） | 无 DB 写 | 无 | ❌ 暂停（deploy.sh `pm2 delete`） |
| `changmen-pm-sports` | `collectors/polymarket-sports/index.js:22-38` | 无监听（出站 WS） | PM 体育 WS 消费 + Gamma 索引刷新/轮询（GAMMA_REFRESH_MS=60s） | **`client_matches.pm_sport` 列** + broadcast 通知 esport | — | ✅ |
| `changmen-polymarket-collector` | `collectors/polymarket-esports/index.js:19` | 无监听 | PM 电竞 Gamma discovery，60s tick（tickRunning 防重叠） | `platform_*` + MarketIndex | — | ✅ |
| `changmen-predictfun-collector` | `collectors/predictfun-collector/index.js:19` | 无监听 | PF REST discovery，15s tick | `platform_*` + market index | — | ❌ 暂停 |
| `changmen-sxbet-collector` | `collectors/sxbet-collector/index.js` | 无监听 | SXBet REST discovery，60s tick | `platform_*` + market index | — | ❌ 暂停 |
| `value-bet`（**不在** ecosystem） | `server/value-bet/value-bet.js` | 无监听 | 正 EV 扫描引擎（engine/fair_odds\|edge\|scanner） | `value_signals` | — | 手动 `npm run value-bet` |

**ecosystem 之外的长驻入口核验**（防止双写/幽灵进程）：
- 独立 composer WRITE 循环 `server/match/matcher/compose/loop.js`（`composer:start`）：**默认拒绝**——`assertComposerMayWrite`（`write_guard.js:42-50`）仅 `MATCH_COMPOSER_FORCE_WRITE=1` 放行；PM2 名 `changmen-matcher` 在 deploy 时被 delete/stop（`deploy-server-remote.sh:336`）。与「唯一合场写路径＝esport 内嵌」一致。
- `pull-vps-market-indexes.mjs --watch`：由 esport spawn，默认仅 PORT=3700（本机 dev）启用（`server.js:188-190`）。
- matcher 独立 UI `matcher:ui`（:4567）：生产 `/matcher/` 由 esport 进程托管 + http_bridge（`server.js:51-57`）；独立 server 仅 dev。

**Runtime Ownership 尚未机器化**（详见 §11 M-01..M-03）：runtime→capability 映射、capability→state 归属、默认启动集/暂停集目前分别只存在于散文、代码与 bash 脚本中——本审计的 index.json 是首次机器化（§13）。

---

## 5. Capability Map

capability 是从 runtime/代码取证**派生**出的归组（非仓库现有实体，无单一文档等价物）。每个 capability 的 runtime 归属与证据：

| capability | runtime（证据） | 拥有的状态/写路径 | 关键证据 |
|---|---|---|---|
| 接入 ingest | `changmen-esport` | `platform_*`/`live_timers` 浏览器镜像 + 内存热缓存 | `router.ts:557,567,577`、`esport-api/store.js` |
| 归一化 match-merge | `changmen-esport` 内嵌循环（30s，`MATCHER_INTERVAL_MS`） | `client_matches` 自动写路径 | `server.js:163-175`、`match_merge_once.js:116`、`compose_once.js:144`、`write_guard.js:41-50` |
| 分发 distribution | `changmen-esport`（GetMatchs M+R）+ realtime-hub | 只读面：比赛列表缓存、`PmSport` 推送 | `DATA_STORAGE.md:80`、`realtime-hub/channels.js:1,3,6` |
| 执行 bet-execution | `changmen-esport`（Pm_*/Pf_* actions + 5 代理） | `orders`、`football_orders` | `http_routes.js:374-382`、`order_store.js:161` |
| 账本 account-ledger | `changmen-esport` | `players`/`profiles` 内存镜像 | `core/db/store.js:12`、`ACCOUNT_BACKEND.md` |
| 发现 discovery | 3 collector 进程（2 paused）+ `changmen-pm-sports` | `platform_*`（VPS 馆）、market index、`pm_sport` 列 | `collectors/*/loop.js`、`pm_sport_store.js:74` |
| 转发 ws-relay | ws_forward engine（内嵌 esport）+ 3+1 hub 进程 | 无 DB 写 | `server.js:72,85`、`ws_forward/index.js:22,51-63` |
| 管控 control-plane | `changmen-esport`（Client_Admin* 30+、platform_sync、CollectConfig） | `platforms.json`、profile 设置 | `actions.ts`、`server.js:92-120` |
| 扫描 value-scan | `value-bet`（手动） | `value_signals` | `value-bet.js`、`signal_store.js` |

观察（事实）：**9 个 capability 中 7 个住在 `changmen-esport` 一个进程里**——这是「runtime ≠ capability」最关键的实证：进程清单（ecosystem）看似 9+1 个单元，能力单元实际几乎单点聚合。文档中无与此等价的 capability 划分（`docs/DATA_STORAGE.md` 的 API 策略表是最接近的半成品）。

## 6. Contract Map

| contract | provider | consumer | 定义/验证 | 证据 |
|---|---|---|---|---|
| HTTP action 契约（104 个） | `server/backend`（`handleEsportRequest`） | `client/web`（`api/client.ts post()`） | `packages/api-contract/src/actions.ts`（ESPORT_ACTIONS=104，机械复算；CORE_INTEGRATION_ACTIONS=10 经复算确认为其子集）；验证：`urls.test.mjs` + `action_registry.test.mjs` | `actions.ts:5-126`、`urls.mjs` |
| HTTP 路径前缀 | backend | web | `ESPORT_PATH_PREFIX="/esport"`（`urls.mjs:3`）；健康检查约定 `/api/games`、`/api/proxy/status` | `urls.mjs`、`PRODUCTION_DEPLOYMENT.md:205-209` |
| WS 推送 | realtime-hub（内嵌 esport） | client/web Socket.IO | 频道 `Polymarket:PmSport`；path `/esport/realtime/socket.io`；握手必带 token；内部广播入口 `POST /esport/internal/broadcast/pm-sport` 仅 loopback（403 otherwise） | `channels.js:1,3,6`、`http_routes.js:365`、`internal_http.js:11-17` |
| WS 转发 | ws_forward | client/web、chrome-extension | 浏览器前缀 `/esport/ws-forward/*`（`index.js:22`）；内嵌默认 IA/OB/RAY/PM-USER（`server.js:72`）；PM-MARKET/PREDICTFUN-MARKET 由独立 hub 承载（`index.js:51-63`） | `ws_forward/index.js`、`server.js:85` |
| HTTP 代理端点 ×5 | `changmen-esport` | client/web | `/esport/http-relay`、`/esport/pb/proxy`、`/esport/ob/proxy`、`/esport/ray/proxy`、`/esport/ia/proxy`（按序尝试） | `http_routes.js:374-382`、`proxy/README.md` |
| Adapter 加载 ABI（**事实上的契约，未版本化**） | `packages/venue-adapter/loader/adapter_paths.mjs` | `server/backend`（requirePlatform）、`server/match/resolver`（scrapers） | 解析顺序：①`GAMEBET_ADAPTER_ROOT` ②monorepo `packages/venue-adapter` ③瘦包 `server/backend/platform_adapter`（gitignored 派生物）；node 模式 → `devtools/platform-probes`（瘦包 `platform_node`） | `adapter_paths.mjs`、`ARCHITECTURE.md:113-117`、`TEAM_BOUNDARIES.md:25-29,97` |
| 团队边界核心契约面（10 action） | — | — | `CORE_INTEGRATION_ACTIONS`：SaveMatch/SaveBet/SaveLiveTimer/SaveScore + GetMatchs×5 + GetData，注释自称「团队边界文档中的核心契约面」 | `actions.ts:115-126` |
| DB 表读/写矩阵 | — | — | **仅文档化**（DATA_STORAGE:7-22），无机器可读 registry | §11 M-04 |

版本化现状（事实）：HTTP action 契约有包版本（0.1.0）但无 schema 版本协商；adapter ABI 完全无版本号；WS 契约无版本号。TEAM_BOUNDARIES.md:57 要求「改响应形状须升契约包版本」——执行依赖人工。

## 7. Boundary Map

### 7.1 Executable 规则（`scripts/check-team-boundaries.mjs`，6 组 RULES :20-95）

| 主体 module | forbidden（import） | allowed 例外 |
|---|---|---|
| client-app（`client/web/src`、`chrome-extension/src`） | `@changmen/db`、`@changmen/shared/match-identity`、`@changmen/platform-probes`、`server/backend`、`server/match`、`server/db`、`devtools/platform-probes` | — |
| client-scripts（`client/web/scripts`） | `@changmen/db`、`@changmen/platform-probes`、`server/backend`、`server/match/matcher` | matcher `compose/` 子树（纯归一化，:38-39 明文例外） |
| platform-adapter-frontend（venue-adapter 各平台浏览器目录） | `@changmen/db`、`@changmen/shared/match-identity`、`@changmen/platform-probes`、`server/backend`、`client/web`、`server/match`、`@/stores`、``@` 别名 | infra：`registry/loader/shared/contract/scripts/_template`（:97-105）；平台内 `shared/` |
| server-backend | venue-adapter 平台私有目录（仅可 `registry|loader|shared|contract|backend|scripts|_template` + 平台内 shared）；`client/web/src`；`server/match` | allowFiles：`scripts/test-packaged-adapter-layout.js`、`core/shared/adapter_paths.test.mjs` |
| platform-probes | `@changmen/venue-adapter`、venue-adapter 平台私有目录 | infra 目录 |
| server-match | `client/web`、venue-adapter 平台私有、`match-(engine|identity)/merge`、`merge/match_merge` | infra 目录 |
| 全局 | legacy 目录存在即违规：`server/platform-node`、`server/platform-probes`、`packages/venue-adapter/node` | — |

### 7.2 检查链全貌（事实）

根 `package.json:44`：`npm test` = `check:boundaries → check:venue-adapter（4 环）→ check:client-core（3 环）→ test:api-contract → test:catalog-smoke（20 步，含 `esport_isolation_audit.smoke.test.mjs` 架构隔离审计）→ turbo run test`。另：matcher 包内 `check-no-merge-import.mjs`（防 compose 反向依赖调度侧，挂 matcher test）；`audit-client-sources.mjs` **手动**不在链。**CI gap（事实）**：`.github/workflows/` 仅 `deploy.yml`，所有架构 gate 只在本地/turbo 链，无 CI 测试门禁。

### 7.3 文档未覆盖但实际存在的边界事实

- `venue-adapter → @changmen/db, @changmen/storage`（`loader/adapter_paths.mjs`、`registry/paths.js`、`scripts/sync-backend-bundle.mjs`）——**client 包依赖 server 侧包**，未出现在 `ARCHITECTURE.md:79-95` 依赖方向图；实际仅限基础设施文件，平台根 ts 未越界（符合 TEAM_BOUNDARIES:89 精神，但字面矩阵未写）。
- `team-resolver → @changmen/venue-adapter` 是 **package.json 声明式依赖**（`resolver/package.json:27`），`scrapers/{ray_scraper.js:119, pb_scraper.mjs:15, ob_scraper.js:135}` 直接 ESM import loader——文档仅描述为「requirePlatform 运行时加载」（ARCHITECTURE:91），低估了其耦合强度。
- `realtime-hub → @changmen/polymarket-sports`（hub 直接依赖 collector 包，server→server 但跨 capability）。
- `backend → venue-adapter / platform-probes` 同时是 package.json 声明依赖 + 运行时路径解析双轨（`backend/package.json:76,82`、`core/shared/adapter_paths.js` re-export 至 client 侧 loader）。

## 8. Existing Registry Map

| registry | 管理什么 | canonical? | 机器可读 | 自动验证 | 消费者 | 进入 Index? | 源/派生 |
|---|---|---|---|---|---|---|---|
| `server/storage/paths.js`（CHANGMEN_LAYOUT，11 键 :13-25） | 目录布局 + storage 路径 | ✅ 源 | ✅ | ✅ paths_smoke | loader、check-boundaries、vite、probes | ✅ 直接 | 源 |
| `docs/PATH_REGISTRY.md` | 上者的文档镜像 + env 覆盖约定 | ❌ 派生（手工） | ❌ | ❌ | 人/AI | ✅ 作为派生登记 | `paths.js` 的手工镜像 |
| `registry/manifest.json` | 17 平台能力开关 | ✅ 源 | ✅ | ⚠️ DEV warn + 部分 vitest | adapters/meta/feeds/backend/icons | ✅ 直接 | 源 |
| `registry/adapters.ts` + `shared/platforms.ts` | 平台清单镜像 ×2 | ❌ | ✅ | ⚠️ DEV warn（adapters） | web/registry | ✅ 作为副本登记 | 手工镜像 |
| `api-contract/schemas.ts:3`（zod enum 17）+ `client-core/types/platforms.ts`（14）+ `chrome-extension/src/content/platforms.js`（14+HGA 遗留）+ `check-collect-platforms.js:25`（11 硬编码）+ `platforms.example.json`（子集） | 平台清单镜像 ×5 | ❌ | 混合 | ❌ 多数无 | 各自局部 | ✅ 作为副本登记 | 手工镜像（§9 R-1） |
| `packages/shared/catalog/*.json`（6 数据文件 + TS 视图层 + `.js` re-export twin + `.browser.ts` 变体） | sport/game/market catalog | ✅ 源 | ✅ | ✅ 3 smoke tests | 60+ 文件 | ✅ 直接 | 源；`.ts/.js` 为视图/兼容派生 |
| `packages/api-contract/src/actions.ts`（+`actions.js`/`schemas.js` 手工 twin） | HTTP action 契约 | ✅ 源 | ✅ | ✅ urls.test | 前后端 | ✅ 直接 | 源；twin 无生成脚本 |
| `lines/*/line.json` ×5 | 产品线锚点 | ⚠️ 零代码消费 | ✅ | ❌ | 仅文档 | ✅ 直接 | 源（但当前是「文档性 manifest」） |
| `sport_catalog.json` 的 `linePath`/`pm2Apps` | line 事实的第二份登记 | ❌ | ✅ | ❌ | catalog 消费者顺带可见 | ✅ 作为副本登记 | line.json 的手工镜像（无同步） |
| `deploy/ecosystem.config.cjs` | PM2 进程清单（9 app） | ✅ 源（进程级） | ✅ | ❌ | PM2、deploy bash | ✅ 直接 | 源 |
| `lines/esport/line.json pm2Apps` | PM2 名的第二份登记 | ❌ | ✅ | ❌ | 无 | ✅ 作为副本登记 | 手工镜像（§9 R-2） |
| `esport-freeze.json`（22 路径） | 电竞冻结面 | ✅ 源 | ✅ | ✅ git gate | check:venue-adapter | ✅ 直接 | 源；**无文档** |
| sync 脚本派生物：`platform_adapter/`、`platform_node/`（gitignored）、两包 exports 块、`platform-icons.generated.css`（committed） | 构建/部署派生 | — | — | 部分（--check） | runtime | ✅ 作为派生登记 | 生成链 §9 R-7 |
| `turbo.json`、根 package.json scripts、deploy/env/*.example | 编排/env 模板 | ✅ 各自域内 | ✅ | ❌ | turbo/npm/人 | ❌ 超出架构真相范围 | 源 |
| `core/shared/` 常量（adapter_paths/storage_paths re-export、ray_paths、matcher_mode） | 路径 shim + 标志位 | ❌（shim） | — | — | backend | ❌ 非独立 registry | `paths.js` / loader 的 re-export |

---

## 9. Duplicate Truths

> 均为**事实登记**，不代表副本当前值必然不一致（漂移风险 ≠ 已漂移）；已知值不一致的进 §10。

| # | 事实 | 源 | 副本（全部手工维护，除非注明） | 防漂移机制 |
|---|---|---|---|---|
| R-1 | **平台清单（17）** | `registry/manifest.json` | ①`registry/adapters.ts:30-48` ②`shared/platforms.ts:4-22` ③`api-contract/schemas.ts:3`（zod enum）④`client-core/types/platforms.ts:4-17`（14，缺 4 馆）⑤`chrome-extension/src/content/platforms.js:2-25`（14+HGA 遗留）⑥`check-collect-platforms.js:25-37`（11 硬编码）⑦`platforms.example.json`（子集）⑧`sport_catalog.json collect.platforms` 及各 catalog 的 per-game 子集 | 仅 adapters DEV warn + `meta.browserSave.test.ts`（部分语义）；③④⑤⑥无校验 |
| R-2 | **PM2 进程名（默认 6 + 暂停 3）** | `deploy/ecosystem.config.cjs` | ①`lines/esport/line.json pm2Apps` ②`packages/shared/catalog/sport_catalog.json pm2Apps` | ❌ 三处无一对账 |
| R-3 | **产品线锚点（linePath/pm2Apps）** | `lines/{code}/line.json` | `sport_catalog.json` 同名字段 | ❌ 无同步脚本 |
| R-4 | **目录布局** | `CHANGMEN_LAYOUT`（paths.js） | `docs/PATH_REGISTRY.md` 全表 | ❌ 双登记无脚本（文档自我承认） |
| R-5 | **esport action 名** | `actions.ts` | `actions.js` 编译 twin（无生成脚本）；router handler 命名 | urls.test / action_registry.test 间接 |
| R-6 | **账号存储模型** | `players` 表（代码：`player_account_record.js`） | CLAUDE.md:163,268 仍写 `profiles.accounts jsonb` | ❌ → 已漂移，见 §10 F-01 |
| R-7 | **PM2/部署清单叙事** | deploy 脚本 + ecosystem | PRODUCTION_DEPLOYMENT §2.1/§3.4、`lines/README.md:25`、`docs/README.md:31`、`SPORTS_PRODUCT_LINES §3` 各有一份文字清单 | 人工 |
| R-8 | **storage 数据目录** | `paths.js:44-49`（默认 `server/backend/storage`） | CLAUDE.md:166 `storage/legacy/esport/*.json`、DATA_STORAGE:30 `storage/platforms.json`（相对路径表述） | ❌ 代码中无 `legacy` 路径段（grep 为空）→ §10 F-15 |
| R-9 | **workspace 成员叙事** | 根 package.json workspaces（无 `packages/shared`） | `ARCHITECTURE.md:103`「npm workspace 成员」 | ❌ 生成器机械复算确认 glob 缺口（lockfile 遗留 link 维持可用）→ §10 F-09 |

---

## 10. Conflicting Truths

> 按任务要求：**未自动修正任何文档**。每条标 `status = conflicted`，给出双方与 likely canonical。`requires_human_decision` 全部为 true（文档修订属于人类裁决，尤其 CLAUDE.md/ARCHITECTURE 有「勿大规模重写」的约束）。

| ID | 主题 | 代码说（canonical 候选） | 文档说 | likely canonical | requires_human_decision |
|---|---|---|---|---|---|
| F-01 | 账号存储模型 | `players` 表为唯一真相，`profiles.accounts jsonb` 已弃写（`rds/player_account_record.js`、`venue_account_key.js`；部署链 028 backfill） | CLAUDE.md:163「账号 → RDS `profiles.accounts` jsonb」、:268 重述 | 代码 + ACCOUNT_BACKEND.md:15-26 | true（改 CLAUDE.md 两行） |
| F-02 | `client_matches` 写者 | 自动循环唯一，但表级有 3 类例外：`pm_sport` 列（`pm_sport_store.js:74`）、UI/ops 人工写（`matcher_store.js:192,225,462,497,557`）、死路径 `store.js:358` | matcher README.md:47「生产唯一 writer = matchMergeOnce → composeOnce」 | 代码 | true（文档补例外说明或删死路径） |
| F-03 | `sport_client_matches` 读路径 | backend router 未接入该读路径（grep 仅命中 store/迁移/smoke/wipe）；GetBaseball 等 = M+J「不读写 RDS 赛表」 | DATA_STORAGE:14（读方=GetBaseball/FootballMatchs）vs :81（M+J）——文档**内部**矛盾 | 代码支持 :81；:14 是未标注的目标态 | true（:14 标「目标态」或修正） |
| F-04 | layout 键 `baseball` | `paths.js:24` 键指向仓库根**不存在**的 `baseball/`；全仓零消费者 | PATH_REGISTRY.md:45 登记「棒球代码目录」 | 代码（键为遗留） | true（删键或重指） |
| F-05 | baseball `sharedPackages` 数量 | `lines/baseball/line.json` = 4 个（client-core, arb-core, api-contract, venue-adapter） | PATH_REGISTRY.md:102-104 = 2 个 | line.json | true |
| F-06 | `sport_catalog.json` 接入状态 | smoke test 存在且在 `npm test` 链；`listActiveSports()` 已导出 | CATALOG.md:10「草案，尚未接入运行时」vs :195-202「阶段 1 已完成」——文档内部张力 | 代码（部分接入）；「运行时接入」定义需澄清 | true |
| F-07 | `scripts/` 根目录规模 | 实际 15 个 js/mjs（含 `probe-ob-*.mjs`、`pf-recover-stuck.mjs` 等） | SPORTS_PRODUCT_LINES:60「根 9 个冻结入口」；ARCHITECTURE:70 同 | 代码 | true |
| F-08 | basketball 产品线 | `lines/basketball/line.json` 存在（生成器确认 5 条 line） | `lines/README.md:14-19` 只列 4 条；CATALOG §2.4 草案无 tennis/basketball 条目 | line.json | true |
| F-09 | `packages/shared` workspace 身份 | 根 package.json workspaces 无 `packages/shared`；lockfile 遗留 link（`package-lock.json:1067-1070`）+ symlink 维持解析 | ARCHITECTURE.md:103「npm workspace 成员」 | 代码运行事实（link 可用）但**声明缺失**；fresh install 行为依赖 arborist 保留 link，存在风险 | true（一行 glob 或改文档，二者取一） |
| F-10 | paths.js 所属包 | `paths.js`/`load_env.js` 实际在 `@changmen/storage`（`server/storage/`，其 package.json exports 含两文件） | ARCHITECTURE.md:102「数据层与路径解析见 `@changmen/db`（paths.js、load_env.js）」 | 代码 | true |
| F-11 | 子包清单陈旧 | matcher 顶层无 `archive/`（实际 compose/docs/lib/link/ops/scripts/tests/ui）；collectors 有 4 包（文档多处只列 2）；packages/ 实际 4 个（文档树列 3，漏 arb-core） | ARCHITECTURE.md:16,34-37,152；server/README.md:48-50 | 代码 | true |
| F-12 | 存储路径表述 | 默认 `server/backend/storage`（`paths.js:44-49`）；代码中无 `legacy` 路径段 | CLAUDE.md:166 `storage/legacy/esport/*.json`；DATA_STORAGE:30 `storage/platforms.json`（相对根表述）；生产实际值依赖 VPS env 覆盖（`ESPORT_DATA_DIR` 等） | 代码 + env；⚠️ 生产 env 实际值为 **UNKNOWN**（未读取 VPS `.env`，本审计不越界） | true |
| F-13 | CODEOWNERS 模板 | `.github/CODEOWNERS` 不存在；模板路径 `/changmen/client/chrome-extension/`、`/changmen/client/platform-adapter/` 均非真实路径（真实：`chrome-extension/`、`packages/venue-adapter/`） | TEAM_BOUNDARIES:121-125 指示复制模板到 `.github/CODEOWNERS` | 代码（目录真实布局） | true |
| F-14 | 采集 CLI 转发 | backend `package.json:18-38` 有 17 条 `ob:*/ray:*/pb:*` 转发 scripts 指向 platform-probes | server/README.md:69-79 命令表未列该组 | 代码 | true（补文档或删脚本，二选一决策） |
| F-15 | esport-freeze 闸门 | `check-esport-freeze.mjs` + `esport-freeze.json`（22 路径）在 `check:venue-adapter` 链上运行，默认拒绝、需 `ALLOW_ESPORT_TOUCH=1` | **所有已读文档零记载**（TEAM_BOUNDARIES/CATALOG/SPORTS_PRODUCT_LINES/CLAUDE 均无） | 代码 | true（补文档） |

## 11. Missing Truths（应存在而缺失）

> **Phase 4 生命周期标注（2026-09-19）**：本表是 Phase 1 的历史审计快照，**不得整表当作当前事实引用**。其中 M-01/M-02/M-03/M-11 已被 Phase 2/4 交付物取代，标记为 **SUPERSEDED**（历史保留，非当前真相）；其余条目仍为 ACTIVE。当前机器可读状态一律以 `.ai/architecture/index.json` 的 `superseded` 节与 `resources`/`runtimes` 节为准。

| ID | 缺失物 | 现状 | 影响 | 生命周期 |
|---|---|---|---|---|
| M-01 | runtime→capability 映射 | 无 registry、无文档等价物（§5 为本次审计首次派生） | 故障/扩容分析只能读代码 | **SUPERSEDED** → index.json `runtimes[].hosts` / `capabilities[].hostedBy`（Phase 2） |
| M-02 | capability→state 归属的机器可读表 | 仅 DATA_STORAGE 散文 | AI/新人无法机查「谁写这张表」 | **SUPERSEDED** → index.json `capabilities[].ownsOperations` → `resources`（Phase 2） |
| M-03 | 默认启动集/暂停集的机器可读声明 | 埋在 bash 条件（`DO_PM2_*` flags）+ 注释里 | index.json 已首次机器化（deploy.sh 机械解析） | **SUPERSEDED** → index.json `runtimes[].defaultDeployed/pausedByDeployScript`（Phase 2） |
| M-04 | DB 表读/写矩阵 registry | 无 | §3 矩阵是审计产物，非仓库常驻物 | ACTIVE（部分缓解：index.json `resources` 节为机器可读形式，但 coverage 仅限 14 项重点状态） |
| M-05 | `.github/CODEOWNERS` | 仅过时模板 | 所有权评审无据可依 | ACTIVE |
| M-06 | `client_matches.pm_sport` 列写者文档 | DATA_STORAGE 未单列 | 「单写者」误解的来源之一（配合 F-02） | ACTIVE（index.json 已机器可读；文档侧仍缺） |
| M-07 | SXBet 产品线叙事 | manifest（paused）+ ecosystem（paused 条目）+ sxbet_market_index.js 存在，但 TEAM_BOUNDARIES/server README/SPORTS_PRODUCT_LINES 零提及 | 平台处于「半存在」状态 | ACTIVE |
| M-08 | esport-freeze 闸门的文档 | 见 F-15 | 触碰冻结面的改动会意外撞 gate | ACTIVE |
| M-09 | CI 架构门禁 | workflows 仅 deploy.yml | 边界检查只在开发者本机强制 | ACTIVE |
| M-10 | adapter ABI 的正式契约（版本/能力清单） | 只有 loader 实现 + 散文 | 瘦包与 monorepo 的兼容靠人工 | ACTIVE |
| M-11 | 平台清单副本的 drift 检查 | 9 处副本（R-1）仅 2 处有局部校验 | 加馆时极易漏改 | **SUPERSEDED** → `npm run check:index-drift`（Phase 2 交付）。**TE-1 实证：本行在 Phase 3 中 actively 误导过 baseline 会话，禁止作为当前事实输出**；当前遗留已改为「7 处 DRIFT 的处置口径」问题，与「检查是否存在」无关 |
| M-12 | `value_signals` 表文档 | 无专条 | 手动 daemon 的数据无人认领记录 | ACTIVE |

## 12. AI Context Problems

> 针对「AI 编码代理在本仓库工作」这一真实场景（CLAUDE.md/AGENTS 机制存在即证明），按危害排序：

1. **首读源含陈旧事实**：CLAUDE.md 是 AI 的默认入口，其 :163/:268（账号模型）、:166（legacy 路径）已与现实冲突（F-01/F-12）——AI 会带着错误前提开始工作，且 CLAUDE.md 自述权威。
2. **无证据优先级标记**：DATA_STORAGE:14 vs :81 这类同文档矛盾（F-03），AI 无法判断哪句是当前态，只能猜或两信其一。
3. **「单写者」过度宣称的反向危害**：matcher 文档宣称「生产唯一 writer」（F-02），一个尽职的 AI 可能把 `pm_sport` 写者或 UI ops 路径当「违规」去「修复」，造成真实破坏。这是**文档过度宣称比缺失更危险**的典型案例。
4. **镜像当源**：平台清单 9 处副本（R-1），AI 读到 `check-collect-platforms.js` 的 11 馆硬编码或 client-core 的 14 馆列表时，极易以偏概全（例：以为 SXBet 不在系统内——M-07）。
5. **未文档化的闸门**：esport-freeze（F-15）会让 AI 的合法修改在 `npm test` 第 4 环神秘失败，且错误信息不指向任何文档。
6. **workspaces glob 缺口（F-09）的误修风险**：AI 发现 `packages/shared` 不在 workspaces 后，最直觉的「修复」可能是动 workspaces 数组或重装依赖——而这可能破坏 lockfile 遗留 link 的微妙平衡。属「必须人工裁决」的典型。
7. **28 万行散文无索引**：每个 AI 会话都重新从 20+ 份文档推导架构，结论质量依赖会话长度；这正是 Architecture Index 要解决的问题（§13）。
8. **CODEOWNERS.example 的错误路径**（F-13）：AI 若按模板生成 CODEOWNERS，会产生无效所有权规则。
9. **本地 gate ≠ 合并 gate（M-09）**：AI 本地跑通 `npm test` 不代表 CI 拦截；合并评审是最后一道也是唯一一道远程防线。

---

## 13. Recommended Minimal Architecture Index 【建议】

> 本节起为**建议**，不是当前事实。原型已按此落地：`.ai/architecture/index.json`（38KB，由 `.ai/architecture/build-index.mjs` 生成，全部条目带 `source`/`evidence`/`status`）。

**设计原则**（与任务约束一一对应）：

1. **索引而非百科**：每条目只放 name/owner-ish 字段 + `source`（真源指针）+ `evidence`（file:line 数组）+ `status`；不复制文档内容。
2. **全部可派生**：modules/runtimes/lines/contracts 名册由生成器**机械读取** workspace package.json、ecosystem.config.cjs、deploy bash、line.json、actions.ts、manifest.json 得出；states/capabilities/rules 为本次审计的代码取证结论，在生成器内以 `AUDIT_FACTS` 块显式标注「code audit 2026-09-19」，并在 JSON 中指向本报告。
3. **诚实状态机**：`verified` / `verified-*`（带限定）/ `conflicted` / `unknown`；宁可 unknown 不猜测（如 F-12 的生产 env 实际值）。
4. **不替代任何现有 registry**：sources 节登记谁是源、谁是派生（§8），index 只做「指路人」。

**最小 schema**（实际采用，即问题 I 的答案）：

```json
{
  "version": 1,
  "sources":   { "<registry>": { "path", "manages", "canonical", "machineReadable", "verification", "consumers", "status" } },
  "modules":   { "<@changmen/name>": { "dir", "version", "private", "changmenDeps", "source", "evidence", "status" } },
  "capabilities": { "<cap>": { "runtime", "owns", "evidence", "status" } },
  "states":    { "<state>": { "writers[]", "singleWriter", "writeRuntimes[]", "persistence", "memoryFirst", "doc", "evidence", "status" } },
  "contracts": { "<contract>": { "provider", "consumer", "definition", "validation[]/evidence[]", "status" } },
  "runtimes":  { "<pm2 name>": { "entry", "portEnv", "defaultDeployed", "pausedByDeployScript", "source", "evidence", "status" } },
  "lines":     { "<code>": { "status", "pm2Apps", "actions", "registeredInLinesReadme", "source", "evidence", "status" } },
  "rules":     { "<rule>": { "enforcement", "chain", "status" } }
}
```

**生成器机械复算已确认的事实样例**：21 包 / uncovered=`[packages/shared]`（F-09）；ESPORT_ACTIONS=104 且 CORE_INTEGRATION 10 个全为其子集；freeze=22 路径；PM2 默认启动集 = esport + 3 hubs + pm-sports + polymarket-collector（与 PRODUCTION_DEPLOYMENT §3.4 一致），暂停集 = sxbet×2 + predictfun-collector；basketball `registeredInLinesReadme=false`（F-08）。

## 14. What MUST NOT be Added 【建议】

- **不得**把 index.json 升级为「架构百科」（复制文档段落、写叙事）——它只存指针与状态。
- **不得**合并任何现有 registry（平台清单 9 副本、PM2 3 副本、linePath 双登记）进 index——index 只登记「谁是源谁是派生」，去重是独立的人类决策（R-1/R-2/R-3）。
- **不得**在冲突未裁决前把任何 `conflicted` 条目「自动解决」为单一真相（§10 全部 15 条）。
- **不得**新增运行时/MQ/向量库/Agent 框架/大型 CLI；生成器保持单文件、零依赖、node 直跑。
- **不得**把审计建议（如 §15）写进 index.json 的事实字段。
- **不得**改动生产业务逻辑、PM2 拓扑、DB schema、adapter 架构、产品线结构、API contract；不得大规模重写 CLAUDE.md（本审计仅建议人工修订其中 2 行 + 1 行路径表述）。

## 15. Recommended Next Step 【建议】

**第一步（人，约 1–2 小时）：裁决 §10 的 15 处冲突。** 全部为文档级修订，按风险从低到高：
1. 低风险直改：F-01（CLAUDE.md 两行）、F-10/F-11（ARCHITECTURE 指向与清单）、F-05、F-08（README 补 basketball）、F-15（补 esport-freeze 一段）。
2. 需一句话团队确认的：F-02（文档补例外 vs 删 `store.js:358` 死路径——建议两者都做）、F-04（删 `baseball` layout 键）、F-07（更新「9 个」或真的清理到 9 个）、F-14。
3. 需慎重决策的：**F-09**（`packages/shared` 加进 workspaces glob——改一行，但需 fresh `npm install` 验证 lockfile 重生）、F-12（确认 VPS `.env` 的 `ESPORT_DATA_DIR`/`CHANGMEN_STORAGE_DIR` 实际值后再定文档表述）、F-13（生成 CODEOWNERS 前先修模板路径）、F-06/F-03（给目标态表述加显式标注，而非删）。

**第二步（机，约半天）：给 R-1/R-2 加 drift 检查**——生成器已能从 manifest.json 与各副本机械对比（它在构建 index 时已顺手算出 14 vs 17 vs 11 的差异），把对比变成 `--check` 即可，无需新 registry。

**第三步（判断题 J）：Context Resolver 值得做，但顺序在仲裁之后。** 最小 Resolver 不是新系统，而是「index.json + 冲突裁决结果」之上的一层只读查询（给定实体名 → 返回 source/evidence/status + 若 conflicted 则返回仲裁备注）。它值得做的理由：本仓库 AI 会话频繁（CLAUDE.md 机制 + 28 万行规模），§12 的 10 个问题里有 6 个（1/2/4/5/6/8）可被 Resolver 直接消解；成本极低（数据源已全部机器化）。**不值得做的信号**：若第二步后仍无人维护 index 的 AUDIT_FACTS 块（它含手取证部分，会随代码演化过期），则应改为「每次审计重生成」模式而非常驻 Resolver——诚实过期优于静默陈旧。

**停止条件确认**：本审计已完成任务书第九、十、十三节全部要求；按第十四节要求，**到此停止**，未进行任何架构重构。

---

## 附录：完成标准 A–J 详细回答

**A. 当前已有哪些 Architecture Truth？**
执行层：CHANGMEN_LAYOUT、manifest.json、catalog JSON、actions.ts、esport-freeze.json、ecosystem.config.cjs、workspaces 数组（7 个 registry）；10 道自动检查（§7.2）；§3 状态矩阵对应的真实写路径代码。文档层：20+ 份 .md（§2 清单），其中 DATA_STORAGE（state）、TEAM_BOUNDARIES（边界）、PRODUCTION_DEPLOYMENT（拓扑）、PATH_REGISTRY（路径）、CATALOG（catalog）、ACCOUNT_BACKEND（账号）、ARB_MULTI_SPORT（多运动上位源）各管一摊。

**B. 哪些真正 canonical？**
被代码消费 + 有校验的源：paths.js、manifest.json、catalog/*.json、actions.ts、esport-freeze.json（+ecosystem 在其域内）。状态层面：`client_matches` 自动写路径 = matchMergeOnce→composeOnce；账号唯一真相 = `players`；平台能力开关 = manifest.json。凡 §10 中「代码说」列均为 canonical 候选。

**C. 哪些只是 documentation？**
PATH_REGISTRY.md（手工镜像）、lines/line.json（机器可读但零代码消费）、DB 读写矩阵、capability 叙事（§5 为审计派生）、adapter ABI（只有实现无契约文档）、M-01..M-12 全部。

**D. 哪些已经可以自动生成？**
index.json 已示范：modules/runtimes/lines/contracts/sources 全机械派生；平台清单副本对账（R-1）与 PM2 三副本对账（R-2）的 `--check` 化是第二步建议；states/capabilities 的 writer 指纹可用 grep 模式半自动生成（本审计用人工+脚本混合，未完全机械化，标为 AUDIT_FACTS）。

**E. 哪些存在重复？** §9 共 9 类（R-1..R-9），核心是平台清单 ×9、PM2 名 ×3、linePath ×2、布局镜像 ×2、账号模型 ×2。

**F. 哪些存在冲突？** §10 共 15 条（F-01..F-15），全部 `status = conflicted` 且 `requires_human_decision = true`；其中文档内部矛盾 2 处（F-03、F-06），文档-代码矛盾 11 处，配置-文档矛盾 1 处（F-09），模板错误 1 处（F-13），未文档化闸门 1 处（F-15 兼具缺失属性）。

**G. 哪些 State Ownership 尚未机器化？** 全部 14 项（§3）。写者信息只存在于代码（file:line）与 DATA_STORAGE 散文中；无任何 registry 声明「谁写哪张表」。index.json 的 states 节是首次机器化尝试（含 3 项 conflicted 标注）。

**H. 哪些 Runtime Ownership 尚未机器化？** runtime→capability 映射（M-01）、capability→state（M-02）、默认/暂停启动集（M-03）此前无任何机器可读形式；index.json 的 runtimes/capabilities 节已机械+取证派生。

**I. Architecture Index 最小 schema？** §13 所列八节 + 三字段（source/evidence/status），已按此落地为 `.ai/architecture/index.json`（生成器 `.ai/architecture/build-index.mjs`，单文件零依赖）。

**J. 下一步是否值得开发 Context Resolver？** 值得，条件性建议：先做 §15 第一步（15 处仲裁，含 F-01/F-12 两个需查 VPS env 的），第二步（R-1/R-2 drift check）落地后，Resolver 的数据面即完备——实现只是一个对 index.json 的只读查询层，无新基础设施。若 AUDIT_FACTS 块无人维护，则降级为「审计时重生成」模式。 Resolver 本身**不在本阶段范围**。

---

### 证据与产物清单

| 产物 | 路径 | 性质 |
|---|---|---|
| 审计报告 | `docs/ARCHITECTURE_TRUTH_AUDIT.md`（本文件） | 新建，文档 |
| Architecture Index 原型 | `.ai/architecture/index.json` | 新建，机器可读，生成物 |
| Index 生成器 | `.ai/architecture/build-index.mjs` | 新建，单文件零依赖脚本 |
| 索引登记 | `docs/README.md` 文档地图增 1 行 | 人工索引补充 |

*未改动：任何生产代码、配置、PM2 拓扑、DB schema、registry 内容、现有文档正文（除新增本文件与 docs/README.md 一行索引外）。*

---

# 阶段 2（2026-09-19）：Conflict-aware Index + Drift Check + Context Resolver

> 本阶段把阶段 1 的 Audit 升级为「AI 可安全消费的 Architecture Truth」。仍**零架构重构、零生产代码改动**；所有产出继续遵守「index 是派生数据，不是第二套人工 Truth」。

## P2-1 文件与产物

| 文件 | 变化 |
|---|---|
| `.ai/architecture/build-index.mjs` | 重写：schema v2 + 内嵌 drift 计算 + `--check` 模式 |
| `.ai/architecture/index.json` | 重新生成（v2），新增/重构 5 个节 |
| `.ai/architecture/resolve-context.mjs` | 新增：最小只读 Resolver（仅消费 index.json） |
| `.ai/architecture/acceptance-cases.mjs` | 新增：5 个验收案例（任务书 §13 全数） |
| `package.json` | 新增 2 条 script：`check:index-drift`、`check:index-acceptance` |
| `docs/ARCHITECTURE_TRUTH_AUDIT.md` | 本增补 |

验证：`check-team-boundaries` ✅；`check:index-acceptance` 5/5 ✅；无其他测试受影响（本阶段改动仅限 `.ai/`、`package.json` 两条 script、本文档）。

## P2-2 Schema 变化（v1 → v2）

1. **`states` → `resources`，ownership 建模到 operation/field 级**。不再允许 `{name, writer}` 扁平结构。每个资源 = `operations[]`，每个 operation 显式声明 `ownershipScope ∈ {table, field, operation, file, unknown}`、`writerCardinality ∈ {single, multiple, unknown}`、`writers[]`（writer 带 `target/runtime/status/evidence`）。`client_matches` 如实建模为 4 个 operation：composeOnce 自动循环（operation/single）、`pm_sport` 字段（field/single，writer=changmen-pm-sports）、UI/ops 人工整行写（operation/multiple）、`saveClientMatches` 死路径（scope/cardinality=unknown，writer status=**dead-code**）。**table-level single writer 抽象被显式禁止**（`meta.ownershipModel`）。
2. **runtime ≠ capability**。`runtimes[].hosts[]` ↔ `capabilities[].hostedBy[]` + `capabilities[].implementedBy[]`（module）。`changmen-esport.hosts` 实测 7 个 capability。
3. **`conflicts` 成为一等顶层节**。15 条（F-01..F-15）全部结构化：`sources[]`（带 evidence-priority 层：`code/registry/checks/docs/readme`）、`likelyCanonicalLayer`（注明「evidence-derived judgment, not verified」）、`humanDecisionRequired: true`、`resolution: null`。**零条被自动解决**。`resources/sources/rules` 通过 `conflicts: ["F-xx"]` 反向引用。
4. **`meta` 证据优先级**：`["code","registry","checks","docs","readme","inference"]` + status 词表 + 三条政策（regeneration / conflict / ownership），全部写入 index 供 Resolver 与 AI 直接读取。
5. **`drift` 节**（构建期机械计算，见 P2-3）。
6. **AUDIT_FACTS 处置**（任务书 §15 评估结论）：`derivation` 字段区分三类——`generated`（机械派生：modules/runtimes/lines/contracts/sources/drift）、`audit-code-review-2026-09-19`（代码取证：resources/capabilities 的 writers 与 evidence，**每次 audit 重新生成，禁止手改**）、`audit-phase-1`（15 条 conflicts = **human-decision-pending**，在人工裁决前不得转为 verified）。

## P2-3 Drift Check（`npm run check:index-drift`）

对比 canonical → derived 副本集合，输出 `PASS / DRIFT / UNKNOWN`，**只检测不修复**，exit 1 on DRIFT。当前实测：

```text
PLATFORM_REGISTRY
  canonical: packages/venue-adapter/registry/manifest.json (17 platforms)
  PASS  registry/adapters.ts / shared/platforms.ts / api-contract/schemas.ts
  DRIFT client-core/types/platforms.ts            missing=[Azuro,Limitless,PredictFun,SXBet]
  DRIFT chrome-extension/src/content/platforms.js missing=[Azuro,Limitless,PredictFun,SXBet,XBet] extra=[HGA]
  DRIFT check-collect-platforms.js                missing=[Azuro,Dex,Limitless,Polymarket,PredictFun,SXBet]
  PASS  platforms.example.json [subset] / sport_catalog collect.platforms [subset]
PM2_REGISTRY
  DRIFT lines/esport/line.json pm2Apps            missing=[6 个 hub/collector app]
  DRIFT sport_catalog.json pm2Apps                missing=[同上]
SUMMARY: 5 PASS, 5 DRIFT, 0 UNKNOWN (detection only — never auto-fixed)
```

所有 DRIFT 均为阶段 1 已登记的既有事实（R-1/R-2 副本风险的具体化），非本阶段引入；处置属 §15 第一步的人类裁决范围。

## P2-4 Context Resolver（`node .ai/architecture/resolve-context.mjs "<query>"`）

- **只读、只消费 index.json**；无 RAG/embeddings/LLM/MCP/UI。
- 机制：query 分词（含任务动词 stopwords）→ index 条目 token 匹配（key +5 / value +1）→ **显式关系扩展**（runtime.hosts → capability → ownsOperations → resource.writers；module → implements → hostedBy；resource → writer runtimes）→ conflict 传播。
- **不猜测**：无命中 → `status: "unknown"` + `notFound` tokens，exit 3；输出每条带 `status` 与 `evidence`；conflict 原样传播（含 `humanDecisionRequired`）。
- 验收：`npm run check:index-acceptance` → **5/5 PASS**（任务书 §13 全数）。

CASE 4 实测输出节选（`"change client_matches ownership"`）——注意 operation 级 writers 与 conflict 传播：

```json
{
  "status": "ok",
  "humanDecisionsRequired": ["F-02", "F-03"],
  "truthSummary": { "verified": 12, "conflicted": 4 },
  "results.resources.client_matches.status": "conflicted",
  "results.resources.client_matches.operations": [
    { "operation": "composeOnce-automated-write", "ownershipScope": "operation", "writerCardinality": "single",
      "writers": [{ "runtime": "changmen-esport", "status": "verified" }] },
    { "operation": "update-pm_sport-field",     "ownershipScope": "field",     "writerCardinality": "single",
      "writers": [{ "runtime": "changmen-pm-sports", "status": "verified" }] },
    { "operation": "manual-row-ops",            "ownershipScope": "operation", "writerCardinality": "multiple", "writers": [ … ] },
    { "operation": "write-via-saveClientMatches","ownershipScope": "unknown",  "writerCardinality": "unknown",
      "writers": [{ "runtime": "changmen-esport", "status": "dead-code" }] }
  ],
  "results.conflicts.F-02": { "status": "conflicted", "humanDecisionRequired": true, "likelyCanonicalLayer": "code" }
}
```

CASE 5 实测（`"some completely unknown capability zzzqqq"`）：`status: "unknown"`，零编造结果，`notFound: ["zzzqqq"]`，exit 3。

## P2-5 验收标准对照（任务书 §18）

| 条目 | 结果 |
|---|---|
| index 仍是 derived truth | ✅ `derivation` 全标注；`meta.regenerationPolicy` 明示禁止手改 |
| Resource 可表达 field/operation ownership | ✅ `ownershipScope`/`writerCardinality`/`operations[]` |
| Runtime 与 Capability 分离 | ✅ `hosts`/`hostedBy`/`implementedBy`（CASE 2 断言） |
| Conflict 一等状态 | ✅ 顶层 `conflicts` 节 + 引用传播 + `humanDecisionRequired` |
| Resolver 不猜测 | ✅ CASE 5 + `notFound` 机制 |
| Resolver 传播 conflict | ✅ CASE 1/4（F-02/F-03） |
| Resolver 返回 evidence | ✅ 所有 writer/entry 带 `evidence[]` |
| platform registry drift detection | ✅ `check:index-drift`（当前 5 DRIFT 为既有事实） |
| check-team-boundaries 通过 | ✅ |
| 现有测试不被破坏 / 无生产代码改动 / 无架构重构 / 无新增外部基础设施 | ✅（改动清单见 P2-1） |

## P2-6 当前仍 Unresolved 的 Truth

1. **15 条 conflicts（F-01..F-15）**：全部 `humanDecisionRequired`，按 §15 分级等待人工裁决；F-09（packages/shared workspaces）与 F-12（VPS env 实际值）需生产环境操作，风险最高。
2. **5 处平台清单 DRIFT + 2 处 PM2 DRIFT**：检测已就位，处置（补副本 or 声明 subset or 收窄 canonical）待裁决。
3. **AUDIT_FACTS 过期风险**：`resources/capabilities` 的 writers 取证于 2026-09-19，代码演化后会静默过期——缓解：每次 audit 重跑 `build-index.mjs`；长期应考虑 writer 指纹的半自动生成（grep 调用方模式）。
4. **UNKNOWN 保留项**：生产 `ESPORT_DATA_DIR`/`CHANGMEN_STORAGE_DIR` 实际值（F-12）；`sport_catalog`「运行时接入」定义（F-06）；line.json `pm2Apps` 是否声明为语义子集（PM2 DRIFT 的处置选项之一）。

## P2-7 下一阶段建议（不自行进入）

按优先级：① 人工裁决 §15 分级清单（1–2 小时，全部文档级）；② 将 `check:index-drift` 接入 `npm test` 链或 CI（当前手动，接入前需先裁决 5 处 DRIFT 的处置口径，否则 test 链会红）；③ 若 AI 会话量上升，给 Resolver 增加「冲突裁决备注」字段（`conflicts[].resolution` 落地后回填）；④ AUDIT_FACTS 半自动化（writer 指纹）仅在 ③ 验证有效后再做。

**停止条件确认**：Conflict-aware Index + Drift Check + 最小 Resolver + 验收案例均已完成，按任务书 §19 停止，未扩展为 Agent Platform/RAG/MCP/UI 等任何形式。

---

# 阶段 4（2026-09-19）：Architecture Truth Reliability

> 目标（任务书）：保证 Architecture Truth 不会把过期、遗漏或未经验证的信息当成当前事实。核心原则：`UNKNOWN > stale truth`，`CONFLICTED > false certainty`，`SUPERSEDED > silently deleted history`，`EVIDENCE > assumption`。

## P4-1 交付与修复对照

| 项 | 结果 | 机制 |
|---|---|---|
| **TE-1**（M-11「无 drift 检查」陈旧事实） | **FIXED** | ① 审计文档 §11 增加生命周期标注（M-01/02/03/11 = SUPERSEDED，历史保留不删除）；② index.json 新增顶层 `superseded` 节（4 条，含 claim/supersededBy/historicalEvidence）；③ Resolver 把 superseded 隔离在 `results.superseded`，仅配 `SUPERSEDED: ... Do not treat as current truth` 警告，不计入 verified；Test B 验证 |
| **TE-2**（client_matches 漏 writer） | **FIXED** | `resources.client_matches.operations` 重扫为 **7 个 operation / 18 个 writer 条目**（新增 compose-id-stub-insert、prune-ended-mark、offline-ops-writes；manual-row-ops 扩为 5 函数；dead-code 扩为 3）。重扫方式：grep 全部 `INSERT/UPDATE/DELETE … client_matches` + 全部 store 导出函数逐一核对。**连带发现（同类 TE-2）**：platform_matches 漏 4 个写函数（clearPlatformMatchIdsForClientMatchIds / clearPlatformMatchIdsPointingAtEnded / prunePredictFunPlatformMatches / reassignPlatformMatchIds / deletePlatformMatchRow）、platform_bets 与 live_timers 的证据文件缺失——全部由 completeness regression 首次暴露后补入。Test C 验证 |
| **G-1**（Resolver 分词） | **FIXED** | 查询与索引共用同一 normalization：camelCase/kebab/snake 统一切词（`matchMerge`=`match-merge`=`match_merge`）。无搜索引擎。Test D 验证 |
| **G-2**（capability 展开） | **FIXED** | 抽取 `expandCapability()`：capability 命中（直接或经 runtime/module）即单跳展开 hostedBy→runtimes、implementedBy→modules、ownsOperations→resources（含 writer runtimes 与 conflict 传播）；有界，不递归全图。Test E 验证 |
| **Truth Freshness**（任务 2） | **交付** | 最小可行机制，零人工 metadata：`.ai/architecture/verified-fingerprints.json` 存证据文件内容哈希（sha1），由 `build-index.mjs --record-verified` 在审计事件时快照（本次已快照 45 个证据文件）；每次构建自动计算每条 audit-derived 条目的 `evidenceStatus ∈ {current, current-partial, unverified, reaudit-required}`；`reaudit-required` 把 `verified` 降级为 `stale`（保留 priorStatus）。无快照覆盖 = `unverified`（UNKNOWN > 假装 verified）。Test A 验证（含完整降级链） |
| **Truth Safety Rule**（任务 7） | **交付** | Resolver 新增 `safety` 层：`warnings[]`（CONFLICTED/STALE/SUPERSEDED 各带处置语）、`negativeAssertions[]`（如「Do NOT assume a single/table-level writer for client_matches」）、`uncertainty: present/none`。不确定性在解析后存活，不被包装成确定性事实。Test F 验证 |
| **Completeness Regression**（任务 4/8） | **交付** | `.ai/architecture/check-truth-completeness.mjs`（`npm run check:index-completeness`）：三规则对账——Rule 1 文件级（代码含目标表字面 DML 的文件必须在 index evidence）；Rule 2 符号级 code→index（DAL 导出函数体内含 DML 者必须被 index writer 命名）；Rule 3 符号级 index→code（index 记录的写符号必须仍存在）。当前 4 目标表（client_matches / platform_matches / platform_bets / live_timers）全 PASS。**检测边界（诚实声明）**：仅静态字面 DML + 平铺导出函数；动态 SQL 拼接、非导出 wrapper 不在覆盖范围，不声称 100% |
| **回归测试 A–G**（任务 8） | **全过** | `acceptance-cases.mjs` 扩展为 12 例（原 5 + A freshness / B superseded / C writers / D tokenization / E expansion / F conflict safety / G unknown） |

## P4-2 文件清单（本阶段全部改动）

修改/新增仅限任务书白名单：`.ai/architecture/*`、`docs/ARCHITECTURE_TRUTH_AUDIT.md`、`package.json`（+1 script）。

- `.ai/architecture/build-index.mjs`（重写：superseded 节 / freshness / client_matches+platform_* writers 补全 / main 守卫 + 导出）
- `.ai/architecture/index.json`（v3 重新生成）
- `.ai/architecture/verified-fingerprints.json`（新增，45 证据哈希）
- `.ai/architecture/resolve-context.mjs`（G-1/G-2/safety/superseded 隔离）
- `.ai/architecture/check-truth-completeness.mjs`（新增）
- `.ai/architecture/acceptance-cases.mjs`（+Tests A–G）
- `package.json`（+`check:index-completeness`）
- `docs/ARCHITECTURE_TRUTH_AUDIT.md`（§11 生命周期标注 + 本章节）

## P4-3 验证结果（全部实跑）

```text
node .ai/architecture/build-index.mjs --record-verified   → recorded 45 evidence hashes
npm run check:index-acceptance    → ALL ACCEPTANCE + RELIABILITY CASES PASS（12/12）
npm run check:index-completeness  → 4/4 PASS（client_matches / platform_matches / platform_bets / live_timers）
npm run check:index-drift         → 5 PASS, 5 DRIFT, 0 UNKNOWN（DRIFT 为 Phase 2 已登记的既有事实，非本阶段引入）
npm run check:boundaries          → OK
```

## P4-4 遗留 Truth 风险（不隐藏不确定性）

1. **CONFLICTED（15 条，F-01..F-15）**：全部仍为 humanDecisionRequired —— 本阶段未自动解决任何一条（纪律要求）。F-02 的 code 侧已完备，docs 侧措辞待人工。
2. **DRIFT（7 处）**：平台清单 5 + PM2 2，处置口径待人工（Phase 3 §15 清单未执行）。
3. **UNVERIFIED / current-partial**：`orders` 等含目录型证据（`server/backend/scripts/ops/`）的条目为 current-partial——「当前文件均匹配快照，但证据含不可哈希边界（目录/ glob）」，不是 fully verified。
4. **UNKNOWN（caller surface）**：`clearPlatformMatchIdsForClientMatchIds`、`deletePlatformMatchRow` 为导出写 API 但全仓无调用方（refactor_audit 符号表除外）——caller surface 记为 UNKNOWN，未伪装成 dead-code。
5. **Freshness 机制边界**：哈希快照锚定「上次审计事件」；evidence 之间的语义关系（如调用方变更但 DAL 文件未变）不在检测范围——Rule 2/3 符号对账部分弥补。
6. **7 处 DRIFT + 15 条 conflict 的处置**：本阶段严格停止，未越界修改。

## P4-5 Production Safety

```text
Production code changed: NO
Production behavior changed: NO
```

改动范围严格限于 `.ai/architecture/*`、审计文档、package.json 一条 script。`check:index-*` 三件套均为手动/可选链，未接入 `npm test`，不影响任何现有检查。

**停止条件确认**：TE-1/TE-2/G-1/G-2 已处理、Truth safety regression 已建立、existing architecture checks 通过。按任务书 §16 停止，未进入 Phase 5 / Agent / RAG / MCP / UI / auto-healing。

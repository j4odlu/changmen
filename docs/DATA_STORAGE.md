# 数据存储边界

changmen 使用 **RDS（PostgreSQL）** 与 **本机 JSON**。数据层入口为 `@changmen/db`（`CHANGMEN_DB_SCRIPT=rds`）。

## 云数据库（生产主路径）

| 表 | 写入方 | 读取方 | 说明 |
|----|--------|--------|------|
| `platform_matches` | 客户端 `API_SaveMatch` → backend | embedded matcher matchMerge | 各平台原始比赛 |
| `platform_bets` | `API_SaveBet` | embedded matcher | 各平台赔率快照 |
| `live_timers` | `API_SaveLiveTimer` → backend | embedded matcher matchMerge | 局数/计时；GetMatchs 不再 overlay |
| `client_matches` | embedded matcher 30s 循环 → `@changmen/matcher` `compose/`（唯一写路径） | 浏览器 `Client_GetMatchs`（只读，不改写） | 合并后的**电竞**比赛列表 |
| `canonical_teams` / `team_venue_maps` | `server/match/resolver`、`server/match/matcher` | matcher 队名插件 | **电竞**队伍 canonical 映射 |
| `sport_client_matches`（+ history） | `sport_merge` 异步落库（N3） | `GetBaseball/FootballMatchs`（双场馆合并成功时） | 体育合并输出；**禁止**混入电竞 `client_matches` |
| `sport_venue_matches` / `sport_venue_bets` | `sport_venue_ingest` | `sport_merge` | 场馆原始赛程/盘口（列名 `venue`，非 `platform`） |
| `sport_canonical_teams` / `sport_team_venue_maps` | 预留；热路径用 JSON plugin | `sport_team_plugin`（当前） | 体育队名；与电竞队名表物理隔离 |
| `sport_client_match_venue_overrides` | matcher UI（接线后） | sport reconcile | 场馆主客 force_aligned / force_reversed |
| `orders` | 电竞下单 API | 前端电竞订单 / 管理端订单查询 | **仅电竞**；足球禁止写入 |
| `football_orders` | 足球页 `Client_SaveFootballOrder` | 足球侧栏 Pinia / `Client_GetFootballOrders` / 管理端足球订单 | 与 `orders` 物理隔离；禁止 `Client_SaveOrder`；前端不写 localStorage；`status`/`profit` 由 C201 + `queryOrderStatus` / yewurecord 列表回写 |

- **RDS 迁移**：`server/backend/db/migrations/`（含 `033_sport_matcher_tables.sql`；`node scripts/apply-rds-schema.mjs`）
- **统一 DB 入口**：`@changmen/db`（`server/db/index.js`）

## 本机 JSON（开发 / 凭证 / legacy）

根目录默认 `server/backend/storage/`（可用 `CHANGMEN_STORAGE_DIR` / `ESPORT_DATA_DIR` 覆盖；兼容 `GAMEBET_STORAGE_DIR`）。

| 路径 | 用途 | 是否上云 |
|------|------|----------|
| `storage/platforms.json` | 场馆采集凭证（gateway/token） | 否；`platform_sync` 启动时读写 |
| `storage/sport/{mlb,soccer,tennis,mlb_pf,soccer_pf,tennis_pf}/match_list.json` | 棒球/足球/网球只读列表缓存（Gamma / Predict.fun）；**不进 RDS、不写 `client_matches`** | 否 |
| `storage/tag_platforms.json`、`players.json` | 已废弃（仅 `migrate-players-to-rds` 导入 RDS） | — |
| `storage/default_odds.json` | 初赔快照 | 否 |
| 用户活跃时间 | RDS `profiles.preferences.lastActiveAt`（`user_presence`，60s 防抖写库） |
| `storage/legacy/esport/*.json` | 开发 legacy 镜像（若存在） | 否；与 RDS 并行 |

内存缓存：`core/esport-api/store.js` 中的 `_matches` / `_bets` / `_timers` 对齐 legacy 文件形状，matcher 进程内还有 RDS snapshot cache；**比赛列表生产以 `client_matches` 为准**。

## 清理策略

| 数据 | 机制 |
|------|------|
| `platform_matches` / `platform_bets` / `live_timers` | **SaveMatch / SaveLiveTimer 全量快照** + 孤儿删除（不在本批 = 平台认为已消失） |
| `client_matches` 离开活跃列表 | matchMerge 每轮 diff 删除 → 移入 `client_matches_history` |
| `client_matches` 长期未 matchMerge | matcher 每小时 **archive**（`server/db/archive_stale.js`，`built_at` 1h 阈值） |
| 手动兜底 | `npm run db:archive-stale`（`scripts/ops/migrations/archive-stale-client-matches.mjs`） |

详见 [ARCHITECTURE.md](./ARCHITECTURE.md) 数据流。

---

## API 数据策略（memory-first 与 RDS）

约定：**HTTP 响应尽量从进程内内存返回**；RDS 负责持久化、冷启动灌入、以及必须强一致的读写。实现入口：`server/backend/core/esport-api/router.ts`；action 名以 `@changmen/api-contract` 为准。

这与「Redis 缓存」不同：内存往往是**主工作集**（write-behind / write-through），不只是 RDS 的只读副本。

### 模式代号

| 代号 | 含义 | API 何时返回 | RDS 角色 |
|------|------|--------------|----------|
| **M→A** | Memory-first + Async persist | 改完内存即返回 | 后台队列 / fire-and-forget（`rds/common.js` `_writeRds`） |
| **M→S** | Memory-first + Sync persist | 等 RDS 成功再返回 | 强一致写入 |
| **M+R** | Memory 读 + RDS 校验 | 优先内存；可能轻量查 meta | 持久化 +  occasional 校验 |
| **R→M** | RDS commit then Memory | 数据库确认后再发布缓存并返回 | 不发布未确认快照 |
| **R** | RDS-direct | 查/写完库再返回 | 唯一数据源 |
| **J** | Local JSON | 读写在 `storage/*.json` | 文件持久化，不进 RDS |
| **—** | 非数据 / 转发 | — | — |

**改 API 前先看本表**：高频可重建 → M→A / M+R；鉴权 / 订单 / 资金 → 禁止改成 fire-and-forget。

### 核心链路（采集 + 列表）

| Action | 模式 | 读 | 写 | 备注 |
|--------|------|----|----|------|
| `API_SaveMatch` | M→A | — | 内存 `_matches` → 异步 RDS | 保持 |
| `API_SaveBet` | M→A | — | 内存 `_bets` → 异步 RDS | 保持 |
| `API_SaveLiveTimer` | M→A* | — | 内存 `_timers` → `writeLiveTimersAsync` | *当前 await RDS，可改为与 SaveBet 一致 |
| `API_SaveScore` | — | — | 空实现 | — |
| `API_UpdatePlatform` | J | `platforms.json` | 同步写文件 | **禁止**多 `changmen-esport` 实例共享假设；凭证非 RDS |
| `Client_GetMatchs` | M+R | 内存 `client_matches`；built_at/pm_sport_rev 未变跳过全量 SELECT | — | 只读 matchMerge 结果，不做 Round/promote overlay |
| `Client_GetBaseballMatchs` / `Client_GetFootballMatchs` / `Client_GetTennisMatchs` | M+J | 进程内存 + `storage/sport/{mlb,soccer,tennis,mlb_pf,soccer_pf,tennis_pf}/`；未命中再打 Gamma / Predict.fun REST，经 `sport_merge`（对不上则 fallback 并列） | 写 sport JSON only | **不读写** `client_matches` / RDS 赛表 |
| `Client_GetDefaultOdds` / `GetMatchDefaultOdds` | M+J | 内存列表 + `default_odds.json` | debounce 写 JSON | — |

### 采集凭证 / 游戏

| Action | 模式 | 说明 |
|--------|------|------|
| `Client_GetCollectPlatform` | J + 外部 | `platforms.json`；TF 可能调 Node 探针后写文件 |
| `Client_GetGames` | J + 内存 | shared catalog + platform 行 |

### 鉴权 / 用户配置

| Action | 模式 | 说明 |
|--------|------|------|
| `Client_Login` | R | 必须 RDS 验密；成功后 `loadProfileById` 灌内存 |
| `Client_Logout` / `Client_RefreshToken` | R | token 会话在 RDS |
| `Client_GetUserInfo` | M | JWT 后纯内存 profile |
| `Client_UpdateSetting` | R→M | 等待 `writeProfileAsync` 确认后发布配置缓存；失败不发布 |
| `Client_SaveData` / `Client_GetData` | R→M / M | 配置按用户协调，写 RDS 确认后发布缓存；ACCOUNT 单独走 players 事务路径 |

### 管理用户与元数据

[changmen 扩展] 管理用户的直接 SQL 通过 `@changmen/db/admin_users.js` 进入 `rds/admin_users_store.js`；改名、角色等已存在的数据方法继续复用。业务层保留输入校验、操作者限制、最后管理员检查、错误文本和缓存刷新时序；本轮不改变原有创建和角色/团队分步写入策略。改名继续使用原 users + profiles 事务，失败回滚后不刷新缓存。

登录只 patch `lastLoginIp/lastLoginAt`；在线状态只 patch `lastActiveAt`，保留 30 分钟窗口、60 秒防抖及旧 sessions 导入策略。配置保存仍由 `core/db/store.js` 组装 preferences 后调用已确认写入，不能把现有每用户队列理解为跨进程字段合并保证。管理模块内未调用的整 preferences 覆盖函数已删除；本轮没有新增偏好整体替换入口。

### 账号 / Player

| Action | 模式 | 说明 |
|--------|------|------|
| `Client_GetAccounts` | M+R | players 为唯一持久化真相，按现有逻辑回源并发布已确认缓存 |
| `Client_SaveAccounts` | R→M | 归属和空覆盖校验；players 事务确认后发布缓存 |
| `Client_CreateTagPlatform` | M→S | 必须等 RDS 建 player 成功 |
| `Client_UpdateBalance` / `DeletePlayer` | M→S | 余额与删除须 RDS ACK |

### 订单 / 资金（强一致区）

| Action | 模式 | 说明 |
|--------|------|------|
| `Client_SaveOrder` / `SaveOrderBind` | M→S | `await upsertOrders`；**禁止** fire-and-forget；**仅电竞** |
| `Client_GetOrderList` / `GetPlayerOrder` | R | 直查 RDS `orders`；体育页禁止调用 |
| `Client_SaveFootballOrder` / `GetFootballOrders` / `AdminFootballOrders` | R | 直查/写入 RDS `football_orders`（含 `status`/`profit`）；前端 Pinia 对齐电竞 `orderStore`（无 localStorage）；**禁止**复用 `orders` / `order_store` |
| `Client_SaveMoneyLog` / `DeleteMoneyLog` | M→S | await RDS |
| `Client_MonthReport` / `GetUserProfit` | R | 聚合 SQL |

### 管理端

全部 **R**（`Client_Admin*`）：报表与运维写操作直读写 RDS；`Client_AdminUsers` 在线状态可读内存 profile。

### 正 EV 仪表盘与体育中继身份

`Client_AdminValueBet` 的 `value_signals` 查询归 `@changmen/db/value_signals.js`。读函数在等待比赛快照前捕获连接池，之后并发读取前三组原查询；比赛诊断继续缓存 8 秒，信号每次读取。仅缺表（`42P01`）返回 `dbAvailable=false`，其它错误继续上抛；不增加表创建、连接初始化、事务或字段转换。

Predict.fun 体育 relay 的用户查询归 `@changmen/db/relay_identity.js`：保留原按 profile ID 排序取首行、空配置/空用户返回空身份及错误交由调用方降级的行为。入口保留原数据库包的延迟初始化；JWT 的签发器经公开入口转导出，原 claims、TTL、环境 token 优先级、60 秒缓存刷新余量及直连/relay 顺序均不变。没有启用已停用的 PF 足球采集，也没有新增生产写入。

### 其它

| Action | 模式 |
|--------|------|
| `Client_GetUsers` | M（`listProfileRows` + presence） |
| `Client_GetChatHistory` | —（固定 `[]`） |
| `SendMessage` | 外部（Telegram） |

### 非 `/esport/*` action

| 路径 | 能否内存回复 |
|------|--------------|
| `/esport/http-relay`、各平台 proxy | 否，转发 upstream |
| `/v4.0/*` | 否 |
| `/`、`/assets/*` | 静态文件，非 RDS |

### 分层总览

```text
高频采集/列表（Save* / GetMatchs）     → M→A / M+R   ✅ 已基本实现
用户配置/KV（SaveData / GetData）      → R→M / M+R   ✅ 写入确认后更新缓存
订单/资金/鉴权                         → M→S / R     ❌ 勿改 fire-and-forget
管理报表                               → R           只读 DB
场馆凭证                               → J           platforms.json（非 RDS）
```

**拓扑约束**：memory-first 主工作集（profile / accounts / 采集热缓存 / 内嵌 matcher 的 `client_matches`）绑定 **单个** `changmen-esport` 进程。生产勿对该 app 开 `instances > 1` 或 cluster；详见 [PRODUCTION_DEPLOYMENT.md §2.1](../PRODUCTION_DEPLOYMENT.md#21-两团队独立发版单-ip--caddy)。

### RDS 异步写队列（`_writeRds`）

| 项 | 行为 |
|----|------|
| 入口 | [`server/db/rds/common.js`](../server/db/rds/common.js)；diag：`/health/diag` → `rdsWrite` |
| 同 `opts.key` | 队列内 **coalesce**，只留最新（含队列已满时）；计入 `coalesced`，**不丢最新** |
| 满队列且无法 coalesce | **drop 本次**（第一版，不踢最旧）；计入 `dropped` + 醒目日志 |
| 调参 | `RDS_WRITE_QUEUE_MAX`（默认 2000）、`RDS_WRITE_CONCURRENCY`（默认 3） |

采集快照写（`platform_*` / `live_timers`）应带 `key: collector:…`。持续 `dropped>0` 先查慢写 / 扩容，再考虑第二版「踢最旧」。

### 可选优化（低优先级）

| 接口 | 方向 | 风险 |
|------|------|------|
| `API_SaveLiveTimer` | 与 SaveBet 一样纯 M→A | 重启丢最近 timer |
| `Client_GetMatchs` | built_at 未变时零 RDS（连 meta 不查） | 仅单机内嵌 matcher 安全 |
| `Client_GetOrderList` | 热订单内存 + RDS 异步 | 实现复杂 |
| `platforms.json` | 迁 RDS 或共享存储（**当前冻结单 esport 实例**） | 部署拓扑变化；见 PRODUCTION_DEPLOYMENT §2.1 |

### 相关代码

| 位置 | 职责 |
|------|------|
| `core/esport-api/store.js` | 采集内存 `_matches` / `_bets` / `_timers` |
| `core/db/store.js` | profile / client_matches 内存与 built_at 缓存 |
| `server/db/rds/common.js` | `_writeRds` 写队列 |
| `server/match/matcher/ops/rds_snapshot_cache.js` | matchMerge 读路径（内嵌优先内存） |
| `server/storage/platform_storage.js` | `platforms.json` |

### 第四轮兼容演练与包边界

数据库升级流程与隔离 PostgreSQL 演练见 [DATABASE_UPGRADE_COMPATIBILITY.md](DATABASE_UPGRADE_COMPATIBILITY.md)。共享包保留统一协议和纯逻辑，环境专属能力按入口隔离；当前消费者证据与后续拆分顺序见 [SHARED_PACKAGE_BOUNDARIES.md](SHARED_PACKAGE_BOUNDARIES.md)。本轮未修改生产结构或业务协议，也未改变发布分类。

# OB 平台复刻计划（A8 前端基线）

> 历史记录：损坏文字依据 Git `c3b3dbdfff40`（`client/web/docs/A8_OB_REPLICATE_PLAN.md`）恢复，保留后续有效更新。原日期及勾选项表示当时状态；当前入口与规则以仓库 `AGENTS.md` 和 `LOCAL_DEV.md` 为准。

最后更新：2026-06-11

## 项目共识（必读）

| 标记 | 含义 |
|------|------|
| **[A8 可证实]** | 可在 `A8/index0706.js`（或 `index.readable.js`）及 Network 抓包中直接对照 |
| **[changmen 推测]** | 根据 A8 前端 API 名、载荷字段、调用时机反推的后端实现；**无 A8 官方服务端源码** |
| **[changmen 扩展]** | changmen 自有能力，A8 浏览器 bundle 中**不存在**对等路径 |

**parity 验收唯一基线**：A8 前端 bundle 行为 +（可选）对照官方站点 Network。
**不是**基线：`matches.json` 布局、`match_merge.js` 合并细节——除非已证明与 A8 前端可见结果一致。

**已删除（2026-06）**：Node `ObFeed`、`feed_bridge`、`ESPORT_BRIDGE`、服务端 Feed 采集。列表仅来自客户端 `saveMatch` + matcher。

生产部署：[../../../PRODUCTION_DEPLOYMENT.md](../../../PRODUCTION_DEPLOYMENT.md)

上级说明：[README.md](./README.md#项目共识)、[changmen/readme.md](../../../readme.md#项目共识)

---

## 1. A8 可证实的 OB 数据分工

```text
[A8 可证实] UMe 插件（浏览器内，约 index.readable.js 92194–92395）

  Client_GetCollectPlatform(OB)
       │
       ▼
  GET gateway/game/index?game_id=0&flag=1&day=1
       │
       ├─► saveMatch ──► API_SaveMatch?OB     （受 CollectConfig 开关控制）
       │
       ├─► 每场 GET game/view?stage_id=0..bo
       │        ├─► fo.save(OB, oddId, …)    （内存，不受回传开关影响）
       │        └─► saveBets ──► API_SaveBet?OB （受开关控制；任 stage 错则不 saveBets）
       │
       ├─► unsub → view → subscribe MQTT（/esport/ws/OB，admin 凭据）
       │
       ├─► MQTT 处理：/market/oddsUpdate|statusUpdate|suspended/ → fo
       │
       ├─► game/getTimer → saveLiveTimer
       │
       └─► wait(30s) 循环

  Client_GetMatchs ← A8 服务端（changmen 用 client_matchs 模拟）
  UI 读赔 ← fo（OB 不用 GetMatchs 快照当初值）
  下注 ← 剪贴板 ACCOUNT + yYe（changmen：obProvider）
```

### 1.1 saveMatch / saveBets 在 A8 中的含义

| API | [A8 可证实] 写入内容 | 前端谁用 |
|-----|---------------------|----------|
| **saveMatch** | 平台赛事 id、队名、开赛时间、BO、队伍 id、Teams/Logo | 拼 **比赛列表**、`Matchs.OB` |
| **saveBets** | 每场每 Map：`SourceBetID`、`SourceHomeID`/`SourceAwayID`、BetName、快照赔 | 拼 **Sources.OB**；下单 itemId |
| **fo.save** | oddId → 实时 odds、锁盘、betId | BetRow 展示；**不进** saveBets 替代 |

### 1.2 CollectConfig（回传开关）

| 项 | [A8 可证实] |
|----|-------------|
| 含义 | 是否调用 `API_SaveMatch` / `API_SaveBet`，**不是**是否连接场馆 |
| 客户端初始 | `collect: new Map()`，**无**本地默认 true |
| 配置来源 | 登录后 `Client_GetData("CollectConfig")`；有则 `new Map(i.collect)` |
| 采集器 | UMe **常驻**；开关关时仍 game/view + fo + MQTT |

**changmen**：与 A8 一致——无 `collect` 或空数组 → 全平台 false；空库 seed 为 `collect: []`。

---

## 2. changmen 现状对照

| 能力 | A8 基线 | changmen 现状 | 分类 |
|------|---------|---------------|------|
| game/index + 过滤 | flag=1&day=1，game_id + 1h | 前端一致 | 已对齐 [A8 可证实] |
| saveMatch | 每轮 UMe 调用 | 前端 `buildMatchesFromList` → saveMatch | 已对齐 [A8 可证实] |
| saveBets + BetName | game/view 全主盘 | 前端 `markets.ts` 有 | 已对齐 [A8 可证实] |
| fo + MQTT 三 topic | 有 | `ob/mqtt.ts` 有 | 已对齐 [A8 可证实] |
| unsub→view→sub | 有 | 轮询 + GetMatchs 同步有 | 已对齐 [A8 可证实] |
| Token 试玩 `$Me` | 有 | `refreshObCollectToken` | 已对齐 [A8 可证实] |
| 下注 yYe | 有 | `obProvider.ts` | 已对齐 [A8 可证实] |
| 比赛列表数据源 | 浏览器 saveMatch → matcher | 客户端 + RDS | 已对齐 [A8 可证实] |
| `matches.json` / `bets.json` | 不可见（黑盒） | legacy JSON + RDS | [changmen 推测] |
| `client_matchs` + `stableId` | 仅见 GetMatchs 响应形状 | `match_merge.js` | [changmen 推测] |
| 前端 4 场并行灌盘 | 顺序 | 顺序 `for...of` | 已对齐 [A8 可证实] |
| `syncObLogin` 启动写 gateway | 无 | `platform_sync.js` | [changmen 扩展] |
| CollectConfig 空库 seed / 无 collect 字段 | A8：全关 | 已对齐：`collect: []`，无前端 fallback | [A8 可证实] |

---

## 3. 验收环境（A8 Parity）

| 项 | 要求 |
|----|------|
| 列表 | **[A8 可证实]** 浏览器 `saveMatch` → matcher → `Client_GetMatchs` |
| 盘口 id | **[A8 可证实]** 浏览器 `saveBets` |
| 实时赔 | **[A8 可证实]** fo + MQTT |
| 服务端 Feed | **无**（FeedHub 已删除） |
| CollectConfig | 与 A8 一致：默认全关，联调时在用户中心显式开启 |
| 启动 | `BAT\dev-esport.bat` / `BAT\dev-esport.bat` + matcher + 插件（PB/Stake） |

---

## 4. 实施阶段（模式 P：A8 Parity）

### 阶段 0 — 文档与共识（本文件 + README）

- [x] 写入项目共识
- [x] 更新 `OB.md` 数据流（模式 P / D）
- [x] `A8_COMPARE_OB_RAY.md` §2 与 `ob/index.ts` 一致
- [x] `changmen/readme.md` 区分模式 P / D
- [x] `server/backend/README.md` 区分模式 P / D

### 阶段 1 — 采集主链 [A8 可证实]（已完成）

- [changmen 扩展] 客户端通过 `API_SaveMatch` / `API_SaveBet` 上报，matcher 的 `compose/` 合场写入 `client_matches`，`Client_GetMatchs` 读取结果。
- [A8 可证实] OB 实时赔率由 fo 消费；`syncObMqttSubscriptionsForGetMatchs`、`getOddsForBetSide` 与 `syncObItemIdsFromFo` 负责订阅和盘口 ID 对齐。

- [x] 1.1 过滤后 `buildMatchesFromList` → `collect.saveMatch`（UMe 92328）
- [x] 1.2 开关关时不 saveMatch/saveBets；**仍** fo + MQTT（Af 74621/74651）
- [x] 1.3 `game/view` 任 stage 错误 → 整场不 saveBets（UMe 92388–92393）
- [x] 1.4 stage 间隔 1500ms（`STAGE_VIEW_INTERVAL_MS`）
- [x] 1.5 灌盘顺序 `for...of`（UMe 顺序）
- [x] 1.6 index 仅 `flag=1&day=1`（UMe 92296）

**验收 [A8 可证实]**：Network 30s 周期内，CollectConfig 开 OB 时见 `API_SaveMatch?OB` + `API_SaveBet?OB`；关开关时无上述请求但 fo 仍变。

### 阶段 2 — GetMatchs 与 fo

**文件**：`server/backend/core/esport-api/store.js`、`server/match/matcher/compose/`、`matchStore.ts`、`models/match.ts`

- [changmen 扩展] 2.1 saveMatch/saveBets → matcher `compose/` 写入 `client_matches`；`Client_GetMatchs` 读取结果。
- [x] 2.2 `Sources.OB.*` 与 saveBets 字段一致（`sourceFromBet` + 脚本 `npm run test:ob`）
- [x] 2.3 `fetchMatches` → `syncObMqttSubscriptionsForGetMatchs`（`matchStore.ts` 已接线）
- [x] 2.4 OB `ViewBetItem` + `getOddsForBetSide` + `syncObItemIdsFromFo`（`models/match.ts`）

**离线验证**：在 `client/web/` 执行 `npm run test:ob`。live smoke 使用 `npm run test:ob-live`，需已启动 backend 并采集 OB 数据。

**说明**：默认 `ESPORT_MATCH_MERGE_MODE=accumulate` 下每平台一行；TJ01 多平台 `Matchs` 并一行属于 merge 目标形态 [changmen 推测]，不在 OB 单平台 parity 范围。

### 阶段 3 — MQTT / fo 细项 [A8 可证实]（已完成）

**文件**：`client/packages/venue-browser/adapter/ob/mqtt.ts`、`oddsStore.ts`、`docs/platforms/OB.md`

- [x] 3.1 三 topic handler（oddsUpdate / statusUpdate / suspended）
- [x] 3.2 `/odd/*` 订阅无 handler — 文档 + 代码注释（与 A8 UMe 一致）
- [x] 3.3 `applyObOddLock` 标注为预留未接线

### 阶段 4 — 下注 [A8 可证实]（契约已校验，live 需账号）

**文件**：`obProvider.ts`

- [x] balance / checkBet / betting / orderList / token 失效与重试路径已实现
- [x] 离线契约：`npm run test:ob-provider`
- [x] 后端 live 只读冒烟：`ESPORT_TEST_BASE=... npm run test:ob-live`
- [x] SaveMatch round-trip（备份/恢复）：`OB_SMOKE_WRITE=1 ESPORT_TEST_BASE=... npm run test:ob-live`
- [ ] **人工验收**：粘贴 OB 账号 → 双击 BetRow 下单成功（需有效 gateway/token）

**一键离线**：`npm run test:ob`
**含 live（后端需 3456）**：`ESPORT_TEST_BASE=http://127.0.0.1:3456 npm run test:ob-live`

### 阶段 5 — CollectConfig 严格对齐（已完成）

**文件**：`collectStore.ts`、`store.js` DEFAULT_USER_KV

- [x] `collectStore.init` 移除 OB/RAY fallback
- [x] `DEFAULT_USER_KV` seed 改为 `collect: []`

| 项 | 状态 |
|----|------|
| 有 KV 时 | 以 `user_kv` 为准 |
| 无 `collect` / 空数组 | 全平台 false |
| 空库 seed | `collect: []` |

模式 P 联调时在用户中心 **显式开启** OB 回传开关。

### 阶段 6 — 服务端 Feed 移除（2026-06，已完成）

| # | 任务 | 状态 |
|---|------|------|
| 6.1 | 删除 FeedHub / `feed_bridge` / 各平台 `backend/feed.js` | ✅ |
| 6.2 | 文档统一客户端采集 + [PRODUCTION_DEPLOYMENT.md](../../../PRODUCTION_DEPLOYMENT.md) | ✅ |
| 6.3 | `BAT\dev-esport.bat` / `BAT\dev-esport.bat` 仅浏览器采集 + matcher | ✅ |

---

## 5. 不在本计划范围（除非抓包证明 A8 有）

- 跨平台 merge 一行多 Sources（`match_merge` merge 模式）— TJ01 为 **目标响应形状** [changmen 推测]
- ~~后端 MQTT 直连场馆（ObFeed）~~ — **已删除**（2026-06）
- `gameOddTypes` / catalog 增强选盘 — [changmen 扩展]

---

## 6. 验收清单（模式 P）

1. [A8 可证实] CollectConfig 开 OB → `API_SaveMatch` + `API_SaveBet`
2. [A8 可证实] CollectConfig 关 OB → 无上述 API，fo 仍更新
3. [A8 可证实] `game/index` 过滤与 30s 轮询
4. [A8 可证实] MQTT `/esport/ws/OB` 连接，market 增量
5. [A8 可证实] token 失效 → 试玩刷新
6. [changmen 推测] `Client_GetMatchs` 结构与 TJ01 一致（Sources id 可对上下注）
7. [A8 可证实] 下注链通

走查表：[A8_WALKTHROUGH_CHECKLIST.md](./A8_WALKTHROUGH_CHECKLIST.md)

---

## 7. 相关文档

| 文档 | 用途 |
|------|------|
| [A8_COMPARE_OB_RAY.md](./platforms/A8_COMPARE_OB_RAY.md) | Token/采集/下注三线对照 |
| [OB.md](./platforms/OB.md) | 运维入口 |
| [A8_REPLICATE_8_PLATFORMS.md](./A8_REPLICATE_8_PLATFORMS.md) | 8 平台总表 |
| [A8_COLLECT_VIEW_PIXEL_PARITY.md](./A8_COLLECT_VIEW_PIXEL_PARITY.md) | 回传开关 UI |

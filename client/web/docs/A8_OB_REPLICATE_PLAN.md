# OB 平台复刻计划（A8 前端基线�?
最后更新：2026-06-11

## 项目共识（必读）

| 标记 | 含义 |
|------|------|
| **[A8 可证实]** | 可在 `A8/A8frontendscipts/2.0.1/index.js`（或 `index.readable.js`）及 Network 抓包中直接对�?|
| **[changmen 推测]** | 根据 A8 前端 API 名、载荷字段、调用时机反推的后端实现�?*�?A8 官方服务端源�?* |
| **[changmen 扩展]** | changmen 自有能力，A8 浏览�?bundle �?*不存�?*对等路径 |

**parity 验收唯一基线**：A8 前端 bundle 行为 +（可选）对照官方站点 Network�?
**不是**基线：`matches.json` 布局、`match_merge.js` 合并细节——除非已证明�?A8 前端可见结果一致�?
**已删除（2026-06�?*：Node `ObFeed`、`feed_bridge`、`ESPORT_BRIDGE`、服务端 Feed 采集。列表仅来自客户�?`saveMatch` + matcher�?
生产部署：[../../../../../PRODUCTION_DEPLOYMENT.md](../../../../../PRODUCTION_DEPLOYMENT.md)

上级说明：[README.md](./README.md#项目共识)、[changmen/readme.md](../../../readme.md#项目共识)

---

## 1. A8 可证实的 OB 数据分工

```text
[A8 可证实] UMe 插件（浏览器内，�?index.readable.js 92194�?2395�?
  Client_GetCollectPlatform(OB)
       �?       �?  GET gateway/game/index?game_id=0&flag=1&day=1
       �?       ├─�?saveMatch ──�?API_SaveMatch?OB     （受 CollectConfig 开关控制）
       �?       ├─�?每场 GET game/view?stage_id=0..bo
       �?       ├─�?fo.save(OB, oddId, �?    （内存，不受回传开关影响）
       �?       └─�?saveBets ──�?API_SaveBet?OB （受开关控制；�?stage 错则�?saveBets�?       �?       ├─�?unsub �?view �?subscribe MQTT�?esport/ws/OB，admin 凭据�?       �?       ├─�?MQTT 处理�?market/oddsUpdate|statusUpdate|suspended/ �?fo
       �?       ├─�?game/getTimer �?saveLiveTimer
       �?       └─�?wait(30s) 循环

  Client_GetMatchs → 服务端（changmen 读取 client_matches）  UI 读赔 �?fo（OB 不用 GetMatchs 快照当初值）
  下注 �?剪贴�?ACCOUNT + yYe（changmen：obProvider�?```

### 1.1 saveMatch / saveBets �?A8 中的含义

| API | [A8 可证实] 写入内容 | 前端谁用 |
|-----|---------------------|----------|
| **saveMatch** | 平台赛事 id、队名、开赛时间、BO、队�?id、Teams/Logo | �?**比赛列表**、`Matchs.OB` |
| **saveBets** | 每场�?Map：`SourceBetID`、`SourceHomeID`/`SourceAwayID`、BetName、快照赔 | �?**Sources.OB**；下�?itemId |
| **fo.save** | oddId �?实时 odds、锁盘、betId | BetRow 展示�?*不进** saveBets 替代 |

### 1.2 CollectConfig（回传开关）

| �?| [A8 可证实] |
|----|-------------|
| 含义 | 是否调用 `API_SaveMatch` / `API_SaveBet`�?*不是**是否连接场馆 |
| 客户端初�?| `collect: new Map()`�?*�?*本地默认 true |
| 配置来源 | 登录�?`Client_GetData("CollectConfig")`；有�?`new Map(i.collect)` |
| 采集�?| UMe **常驻**；开关关时仍 game/view + fo + MQTT |

**changmen**：与 A8 一致——无 `collect` 或空数组 �?全平�?false；空�?seed �?`collect: []`�?
---

## 2. changmen 现状对照

| 能力 | A8 基线 | changmen 现状 | 分类 |
|------|---------|---------------|------|
| game/index + 过滤 | flag=1&day=1，game_id + 1h | 前端一�?| 已对�?[A8 可证实] |
| saveMatch | 每轮 UMe 调用 | 前端 `buildMatchesFromList` �?saveMatch | 已对�?[A8 可证实] |
| saveBets + BetName | game/view 全主�?| 前端 `markets.ts` �?| 已对�?[A8 可证实] |
| fo + MQTT �?topic | �?| `ob/mqtt.ts` �?| 已对�?[A8 可证实] |
| unsub→view→sub | �?| 轮询 + GetMatchs 同步�?| 已对�?[A8 可证实] |
| Token 试玩 `$Me` | �?| `refreshObCollectToken` | 已对�?[A8 可证实] |
| 下注 yYe | �?| `obProvider.ts` | 已对�?[A8 可证实] |
| 比赛列表数据�?| 浏览�?saveMatch �?matcher | 客户�?+ RDS | 已对�?[A8 可证实] |
| 前端 4 场并行灌�?| 顺序 | 顺序 `for...of` | 已对�?[A8 可证实] |
| `syncObLogin` 启动�?gateway | �?| `platform_sync.js` | [changmen 扩展] |
| CollectConfig 空库 seed / �?collect 字段 | A8：全�?| 已对齐：`collect: []`，无前端 fallback | [A8 可证实] |

---

## 3. 验收环境（A8 Parity�?
| �?| 要求 |
|----|------|
| 列表 | **[A8 可证实]** 浏览�?`saveMatch` �?matcher �?`Client_GetMatchs` |
| 盘口 id | **[A8 可证实]** 浏览�?`saveBets` |
| 实时�?| **[A8 可证实]** fo + MQTT |
| 服务�?Feed | **�?*（FeedHub 已删除） |
| CollectConfig | �?A8 一致：默认全关，联调时在用户中心显式开�?|
| 启动 | `BAT\dev.bat parity` / `BAT\dev.bat` + matcher + 插件（PB/Stake�?|

---

## 4. 实施阶段（模�?P：A8 Parity�?
### 阶段 0 �?文档与共识（本文�?+ README�?
- [x] 写入项目共识
- [x] 更新 `OB.md` 数据流（模式 P / D�?- [x] `A8_COMPARE_OB_RAY.md` §2 �?`ob/index.ts` 一�?- [x] `changmen/readme.md` 区分模式 P / D
- [x] `server/backend/README.md` 区分模式 P / D

### 阶段 1 �?采集主链 [A8 可证实]（已完成�?
**文件**：`packages/venue-adapter/ob/collect.ts`、`markets.ts`（比赛列�?HTTP 在同模块�?`markets.ts`�?
- [x] 1.1 过滤�?`buildMatchesFromList` �?`collect.saveMatch`（UMe 92328�?- [x] 1.2 开关关时不 saveMatch/saveBets�?*�?* fo + MQTT（Af 74621/74651�?- [x] 1.3 `game/view` �?stage 错误 �?整场�?saveBets（UMe 92388�?2393�?- [x] 1.4 stage 间隔 1500ms（`STAGE_VIEW_INTERVAL_MS`�?- [x] 1.5 灌盘顺序 `for...of`（UMe 顺序�?- [x] 1.6 index �?`flag=1&day=1`（UMe 92296�?
**验收 [A8 可证实]**：Network 30s 周期内，CollectConfig 开 OB 时见 `API_SaveMatch?OB` + `API_SaveBet?OB`；关开关时无上述请求但 fo 仍变�?
### 阶段 2 — GetMatchs 与 fo
**文件**：`server/backend/core/esport-api/store.js`、`server/match/matcher/compose/`、`matchStore.ts`、`models/match.ts`

- [changmen 扩展] 客户端通过 `API_SaveMatch` / `API_SaveBet` 上报，matcher 的 `compose/` 合场写入 `client_matches`，`Client_GetMatchs` 读取结果。
- [A8 可证实] OB 实时赔率由 fo 消费；`syncObMqttSubscriptionsForGetMatchs`、`getOddsForBetSide` 与 `syncObItemIdsFromFo` 负责订阅和盘口 ID 对齐。

**离线验证**：在 `client/web/` 执行 `npm run test:ob`。live smoke 使用 `npm run test:ob-live`，需已启动 backend 并采集 OB 数据。
### 阶段 3 �?MQTT / fo 细项 [A8 可证实]（已完成�?
**文件**：`packages/venue-adapter/ob/mqtt.ts`、`oddsStore.ts`、`docs/platforms/OB.md`

- [x] 3.1 �?topic handler（oddsUpdate / statusUpdate / suspended�?- [x] 3.2 `/odd/*` 订阅�?handler �?文档 + 代码注释（与 A8 UMe 一致）
- [x] 3.3 `applyObOddLock` 标注为预留未接线

### 阶段 4 �?下注 [A8 可证实]（契约已校验，live 需账号�?
**文件**：`obProvider.ts`

- [x] balance / checkBet / betting / orderList / token 失效与重试路径已实现
- [x] 离线契约：`npm run test:ob-provider`
- [x] 后端 live 只读冒烟：`ESPORT_TEST_BASE=... npm run test:ob-live`
- [x] SaveMatch round-trip（备�?恢复）：`OB_SMOKE_WRITE=1 ESPORT_TEST_BASE=... npm run test:ob-live`
- [ ] **人工验收**：粘�?OB 账号 �?双击 BetRow 下单成功（需有效 gateway/token�?
**一键离�?*：`npm run test:ob`
**�?live（后端需 3456�?*：`ESPORT_TEST_BASE=http://127.0.0.1:3456 npm run test:ob:all`

### 阶段 5 �?CollectConfig 严格对齐（已完成�?
**文件**：`collectStore.ts`、`store.js` DEFAULT_USER_KV

- [x] `collectStore.init` 移除 OB/RAY fallback
- [x] `DEFAULT_USER_KV` seed 改为 `collect: []`

| �?| 状�?|
|----|------|
| �?KV �?| �?`user_kv` 为准 |
| �?`collect` / 空数�?| 全平�?false |
| 空库 seed | `collect: []` |

模式 P 联调时在用户中心 **显式开�?* OB 回传开关�?
### 阶段 6 �?服务�?Feed 移除�?026-06，已完成�?
| # | 任务 | 状�?|
|---|------|------|
| 6.1 | 删除 FeedHub / `feed_bridge` / 各平�?`backend/feed.js` | �?|
| 6.2 | 文档统一客户端采�?+ [PRODUCTION_DEPLOYMENT.md](../../../../../PRODUCTION_DEPLOYMENT.md) | �?|
| 6.3 | `BAT\dev.bat` / `BAT\dev.bat parity` 仅浏览器采集 + matcher | �?|

---

## 5. 不在本计划范围（除非抓包证明 A8 有）

- 跨平�?merge 一行多 Sources（`match_merge` merge 模式）�?TJ01 �?**目标响应形状** [changmen 推测]
- ~~后端 MQTT 直连场馆（ObFeed）~~ �?**已删�?*�?026-06�?- `gameOddTypes` / catalog 增强选盘 �?[changmen 扩展]

---

## 6. 验收清单（模�?P�?
1. [A8 可证实] CollectConfig 开 OB �?`API_SaveMatch` + `API_SaveBet`
2. [A8 可证实] CollectConfig �?OB �?无上�?API，fo 仍更�?
3. [A8 可证实] `game/index` 过滤�?30s 轮询
4. [A8 可证实] MQTT `/esport/ws/OB` 连接，market 增量
5. [A8 可证实] token 失效 �?试玩刷新
6. [changmen 推测] `Client_GetMatchs` 结构�?TJ01 一致（Sources id 可对上下注）
7. [A8 可证实] 下注链�?

走查表：[A8_WALKTHROUGH_CHECKLIST.md](./A8_WALKTHROUGH_CHECKLIST.md)

---

## 7. 相关文档

| 文档 | 用�?|
|------|------|
| [A8_COMPARE_OB_RAY.md](./platforms/A8_COMPARE_OB_RAY.md) | Token/采集/下注三线对照 |
| [OB.md](./platforms/OB.md) | 运维入口 |
| [A8_REPLICATE_8_PLATFORMS.md](./A8_REPLICATE_8_PLATFORMS.md) | 8 平台总表 |
| [A8_COLLECT_VIEW_PIXEL_PARITY.md](./A8_COLLECT_VIEW_PIXEL_PARITY.md) | 回传开�?UI |

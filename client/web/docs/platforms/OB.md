# OB 采集

> **电竞 OB**（本文）：MQTT + `game/index`，写入 `fo`。  
> **体育 OB / 熊猫试玩**（足球页）：JSON `yewuws2`，见 **[OB_SPORT.md](./OB_SPORT.md)**。两套凭证与通道禁止混用。
>
> **A8 对照**（Token / 采集 / 下注）：见 [A8_COMPARE_OB_RAY.md](./A8_COMPARE_OB_RAY.md#ob-平台)。  
> **复刻计划**（A8 前端基线）：见 [../../docs/A8_OB_REPLICATE_PLAN.md](../../docs/A8_OB_REPLICATE_PLAN.md)。

## 入口

`ob/index.ts` → `startObCollector()`

## 数据流

### 模式 P — A8 Parity（**复刻目标**，对齐 UMe）

```text
HTTP game/index (30s, flag=1&day=1)
  → 过滤 game_id + start_time
  → buildMatchesFromList → saveMatch          ← CollectConfig 开时回传
  → 每场 unsub → loadMarketsForMatch → saveBets → subscribe
MQTT（约 3s 后 connectObMqtt）
  → 订阅 odd/* + market/*（与 A8 n9 一致）
  → **处理** /market/oddsUpdate|statusUpdate|suspended → fo
  → /odd/* 等无 handler（与 A8 UMe 相同）
syncObLiveTimer → API_SaveLiveTimer
```

CollectConfig 关：仍 game/view + fo + MQTT；**不** saveMatch/saveBets。

**MQTT**：[changmen 扩展] `packages/venue-adapter/ob/realtime.ts` 支持官方试玩源直连和 CHANGMEN 转发。`mqttSession.ts` 从试玩登录结果解析官方 MQTT 地址并查询 memberId，clientId 为 `mqttjs_dj{memberId}`；CHANGMEN 模式通过 `/esport/ws-forward/OB?u=...` 转发到同一官方源。连接配置不使用固定 clientId，也不把采集 HTTP token 当作 MQTT username；账密定义见 `mqttConfig.ts`。

项目数据流见 [ARCHITECTURE.md](../../../../docs/ARCHITECTURE.md)。

## 开赛时间过滤（对齐 A8）

```ts
const horizon = Date.now() / 1000 + 3600;
list.filter(row => games.includes(gid) && num(row.start_time) < horizon);
```

`StartTime` 存 **毫秒**：`start_time * 1000`（`ob/matches.ts`）。

## 盘口

| 模块 | 作用 |
|------|------|
| `ob/markets.ts` | 按 BO 拉各局 `loadMarketsForMatch` |
| `ob/winMarket.ts` | A8 GameID → OB game_id 映射（备用） |
| `ob/parse.ts` | 数值/字段解析 |
| `platform.BetName` | 正则过滤可采集盘口名 |

## 认证（采集）

| 项 | 说明 |
|----|------|
| 常态 | `getCollectPlatform("OB")` → `Client_GetCollectPlatform`（`Gateway` + `Token`） |
| 失效 | `game/index` 且 `data === "token"` → `refreshObCollectToken()`（直连 A8 同款试玩 URL，只写 `token`） |
| HTTP | `ob/http.ts` → `directGet`（**Axios/XHR**，对齐 A8 `Rr.get`）直连 OB `gateway` |
| MQTT | [changmen 扩展] 官方试玩源直连或 CHANGMEN 转发，配置由 `mqttSession.ts` 生成 |

[changmen 扩展] backend 启动时由 `core/esport-api/platform_sync.js` 的 `resolveObSession()` 准备采集配置。试玩地址定义见 `packages/venue-adapter/ob/constants.ts`。

[A8 可证实] token 失效后的刷新只通过 `API_UpdatePlatform({ provider: "OB", token })` 更新 token，不更新 gateway。当前 `refreshObCollectToken()` 从试玩响应的 `data.token` 或 `data.pc` URL 提取 token，见 `packages/venue-adapter/ob/collect.ts`。

试玩 UI：`api/v4.ts` → `enterCreditPlate("OB")`（仅 `window.open(pc)`，不写采集配置）。

下注凭证：剪贴板账号 → `ACCOUNT` → `obProvider`（与采集配置分离）。

## MQTT topic（对齐 A8 UMe）

| Topic 前缀 | 订阅 | fo handler |
|------------|------|------------|
| `/market/oddsUpdate/` | ✅ | ✅ 更新 odd |
| `/market/statusUpdate/` | ✅ | ✅ 整盘锁 |
| `/market/suspended/` | ✅ | ✅ 整盘锁 |
| `/odd/insert/` … `/odd/suspended/` | ✅ | ❌ 与 A8 相同，无 handler |
| `/market/visible/`、`sortCodeUpdate/` | ✅ | ❌ |

锁盘主路径：`game/view` 灌盘时的 `Status` + 上述 market 三 topic。`oddsStore.applyObOddLock` 预留未接线。

## 下注（obProvider）

| 步骤 | API | 凭证 |
|------|-----|------|
| 余额 / uid | `GET /game/balance` | ACCOUNT |
| 验盘 | `POST /game/bet`（probe 1 元） | secret_key = md5(token_ts_uid_) |
| 下单 | `POST /game/bet` | 同上 |
| 注单 | `GET /game/orderList` | status 1/2 |

以下命令在 `client/web/` 执行：

```text
npm run test:ob              # GetMatchs 形状 + provider 离线契约
npm run test:ob-provider     # 仅 provider 契约
```

离线验证时不设置 `ESPORT_TEST_BASE`，避免触发脚本的在线登录分支。在线验收使用当前 Cookie 登录的客户端及 Network 抓包，核对采集上报、`Client_GetMatchs` 和 MQTT 更新。

`test:ob-live` / `test:ob:all` 尚未适配当前 Cookie 登录和目录布局，不作为当前在线验收入口。

# IA（采集 `wQe` + 下注 `CYe`）

> 历史记录：损坏文字依据 Git `069518ce5f67`（`client/web/docs/platforms/IA.md`）恢复，保留后续有效更新。原日期及勾选项表示当时状态；当前入口与规则以仓库 `AGENTS.md` 和 `LOCAL_DEV.md` 为准。

A8 bundle：`wQe`（采集）、`CYe`（下注）。changmen 实现：`client/packages/venue-browser/adapter/ia/`。

**前置**：采集 HTTP、下注 HTTP（无 `proxyId` 或 `forceDirect`）均需 **Gamebet Chrome 扩展**（对齐 A8 `Zn`）。无扩展时采集跳过；下注 `iaMrPost` 抛错。

---

## 模块

| 文件 | A8 | 作用 |
|------|-----|------|
| `a8Collect.ts` | `wQe` 内联 `t` | 写死 gateway / 空 token / games / betName |
| `collect.ts` | `wQe` | `waitForUser` → WS + 30s HTTP 轮询 |
| `transport.ts` | `Zn.get/post` | 采集 HTTP（扩展代发） |
| `realtime.ts` | `K0(bQe,…)` | WS 直连 `47.115.75.57/esport/ws/IA` |
| `messages.ts` | `roomMessageCallBack` | 锁盘 / 赔率 push → `oddsStore` |
| `markets.ts` | `o(matchId)` | `getPointsListSplit` → fo + SaveBet 行 |
| `bet_transport.ts` | `mr.post` + `Cr.http` | 下注 HTTP 路由（Zn / PROXY） |
| `bet.ts` | `CYe` | 余额 / checkBet / getOrders / playMore |

探针：`devtools/platform-probes/ia/`。后端调试：`/esport/ia/proxy`（前端主链路不用）。

---

## 一、采集 `wQe`

### 启动

1. `await waitForUser()`（`collect.ts`）
2. `const t = iaCollectPlatform()` — HTTP 与 WS **共用**同一对象（非 `getCollectPlatform`）
3. 立即 `createIaRealtimeClient(t.Gateway).start()`
4. 递归 `poll()`：每 30s

### 双通道

| 通道 | 目标 | 间隔 | changmen 实现 |
|------|------|------|----------------|
| HTTP 列表 + 盘口 | `https://ilustre-analytics.org` | 30s | `iaCollectGet` / `iaCollectPost`（**Zn**） |
| Socket.IO | `wss://47.115.75.57` path `/esport/ws/IA` | 实时 | `realtime.ts` 浏览器直连 |

### HTTP 采集（为何走扩展）

页面源站是 changmen（`localhost` 等），请求 IA 源站会被 **CORS** 拦截。A8 用 `Zn.get/post`；changmen 用 `a8PluginGet/Post`（`transport.ts`）。

```text
GET  {t.gateway}/api/game/game/gameListPageSplit/     header: token: ""
POST {t.gateway}/api/game/game/getPointsListSplit      header: token: ""
```

过滤：`t.games`（`["1","2","3","16","43"]`）；盘口名仅 `betRe.test`（无 catalog 二次过滤）。

### WebSocket

```text
io("wss://47.115.75.57", {
  path: "/esport/ws/IA",
  extraHeaders: { Origin: t.gateway, token: "hello" },
  auth: { token: t.gateway },
})
→ emit("RoomJoin", { room_type: "room_type_index_content_push" })
→ on("roomMessageCallBack", …)   // 在 connect 回调内注册
```

- **不要** A8 登录 JWT；**不要** IA API token
- 不经本地 WS relay / Electron IPC

**运维说明**（2026-06）：`47.115.75.57` 上 `/esport/ws/IA` 曾实测 **HTTP 404**，WS 会持续重连失败；HTTP 轮询仍可能正常。A8 硬编码同地址，上游不可用时期行为一致。

### WS 消息

| `message_type` | 处理 |
|----------------|------|
| `message_type_bet_item_single_lock` | `updateBetLock`（`status !== 1` 封盘） |
| `message_type_push_point_change` | 已知 oddId → `save(…, isLock: false)`（A8 `Xn` 无 betId） |

### HTTP fo 灌盘

对齐 A8 `Xn(id, point, status!==1, playId)`：仅 `point.status !== 1` 为封盘；遍历全部 `team_points`。

### [changmen 扩展]

每轮 poll 成功后 `collect.saveMatch` / `collect.saveBets` 上报服务端（A8 只写本地 `fo`）。

---

## 二、下注 `CYe`

下注打到 **`account.gateway`**（用户 IA 账号），与采集用的 `ilustre-analytics.org` **不是同一 host**。

### HTTP 路由（`bet_transport.ts` → `iaMrPost`）

对齐 A8 `mr.post(account, url, body, { headers: e0() }, Cr.http, forceDirect?)`：

| API | `forceDirect` | 无 `proxyId` | 有 `proxyId` |
|-----|---------------|--------------|--------------|
| `getBalance` | 否 | **Zn**（扩展） | **PROXY**（http-relay + `x-proxy-url`） |
| `checkBet` 限红 / 盘口 | **是** | **Zn** | **Zn**（不走 PROXY） |
| `getOrders` | **是** | **Zn** | **Zn** |
| `betting` / `playMore` | 否 | **Zn** | **PROXY** |

- **Zn** = `a8PluginPost`（扩展代发，绕 CORS）
- **PROXY** = `accountIaPost` → 本站 `/esport/http-relay`（协议同 A8 `localStorage.PROXY` + `x-proxy-url`，默认 A8 为 `https://47.115.75.57`）

### checkBet 要点

- 限红：`money_max === 0` 失败
- 盘口：child / point 均须 **`status === 1`**（滚球 `status=2` 在 checkBet 视为封盘）
- 载荷：`items` JSON + `odd_change_type: 1` + `lang: 1`

### getOrders

`receive_status` / `prize_status` 映射见 `mapIaHistoryRow`；pending 时每 3s 轮询直至无 pending（A8 不排序，changmen 同）。

---

## 三、凭证

| 用途 | 来源 | 说明 |
|------|------|------|
| 采集 `t` | `a8Collect.ts` 写死 | gateway=`ilustre-analytics.org`，`token=""` |
| 后端默认 | `platform_sync.syncIaFromA8Defaults()` | 同步 `collect_credentials.js` |
| 覆盖 | `IA_GATEWAY` 等 env | 仅影响 `platforms.json`；**前端采集仍用 `a8Collect` 硬编码** |
| 下注 | 用户 `ACCOUNT`（IA） | `gateway` + `token`；可选 `proxyId` |

---

## 四、验收清单

1. 已安装扩展 + 已登录 changmen
2. 控制台 `[IA]比赛列表:…ms` 周期出现（HTTP 采集）
3. 有扩展时 IA 列表有盘（`oddsStore` / 服务端 `saveMatch`）
4. WS：Network 可见 `47.115.75.57`（上游正常时应 `connect`；404 时仅 HTTP）
5. IA 账号：`checkBet` → `playMore` 成功（无 proxyId 时走扩展）

---

## 五、与 A8 差异汇总

| 项 | A8 | changmen |
|----|-----|----------|
| 采集/下注 HTTP（无 proxy） | `Zn` | `Zn`（已对齐） |
| PROXY 入口 | `localStorage.PROXY` ?? `47.115.75.57` | `/esport/http-relay` |
| 上报服务端 | 无 | `saveMatch` / `saveBets` |
| WS 状态观测 | 无 | `directRealtimeStatus` |

详见 [`A8_COMPARE_ALL_PLATFORMS.md`](./A8_COMPARE_ALL_PLATFORMS.md)、[`A8_REPLICATE_8_PLATFORMS.md`](../A8_REPLICATE_8_PLATFORMS.md)。

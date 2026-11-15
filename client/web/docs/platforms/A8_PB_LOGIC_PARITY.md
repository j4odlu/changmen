# PB（平博）逻辑 parity：A8 bundle ↔ changmen

> 历史记录：损坏文字依据 Git `c3b3dbdfff40`（`client/web/docs/platforms/A8_PB_LOGIC_PARITY.md`）恢复，保留后续有效更新。原日期及勾选项表示当时状态；当前入口与规则以仓库 `AGENTS.md` 和 `LOCAL_DEV.md` 为准。

真源：`A8/index0706.js`（`Oi`/`q0`=PB，`AQ`/`k0`/`TQ`/`PZe`/`_Q`/`Zn`）。

验收：同一 PB 账号与配置下，请求路径、关键头、body、轮询与分支与 A8 一致。

| # | 能力 | A8 符号 | changmen 路径 | 状态 |
|---|------|---------|---------------|------|
| 1 | 采集轮询 5s | `AQ` | `client/packages/venue-browser/adapter/pb/collect.ts` | 已实现 |
| 2 | 落库 60s | `GS` | `client/packages/venue-browser/adapter/pb/collect.ts` `SAVE_MS` | 已实现 |
| 3 | 无账号 3s + clean | `AQ` | `client/packages/venue-browser/adapter/pb/collect.ts` | 已实现 |
| 4 | 采集仅 `balance!==undefined` 的 PB 账号 | `bv` | `client/packages/venue-browser/adapter/pb/auth.ts` | 已实现 |
| 5 | 不用 platforms.json 采盘 | — | 同上 | 已实现 |
| 6 | [A8 可证实] `getPlatform(PB)` 仅用 games 过滤 | `Ut.getPlatform` / `YY` | `getGames`（暂停 `getCollectPlatform`） | [changmen 扩展] 保留游戏配置，暂停采集凭证请求 |
| 7 | 拉盘 `Zn.get` euro/odds | `_Ze` | `client/packages/venue-browser/adapter/pb/transport.ts` | 已实现 |
| 8 | 请求头 `k0` 固定 515 | `k0` | `shared/platforms/pbHeaders.ts` | 已实现 |
| 9 | `TQ` key `${matchId}:${map}` | `TQ.set` | `client/packages/venue-browser/adapter/pb/lineCache.ts` | 已实现 |
| 10 | 余额 `Zn.post` account-balance | `PZe.getBalance` | `providers/pbProvider.ts` | 已实现 |
| 11 | checkBet 仅 `TQ.get` | `PZe.checkBet` | `providers/pbProvider.ts` | 已实现 |
| 12 | checkBet `Zn.post` all-odds-selections | `PZe.checkBet` | 同上 | 已实现 |
| 13 | 下单 `Zn.post` buyV4 | `PZe.betting` | 同上 | 已实现 |
| 14 | `PENDING_ACCEPTANCE` → `_Q` | `_Q` | `providers/pbRejectPoll.ts` | 已实现 |
| 15 | 拒单 `sessionStorage` `PB:{accountId}:Order` | `SQ` | 同上 | 已实现 |
| 16 | `getOrders` wager-filter OPEN+SETTLED | `PZe.getOrders` | `providers/pbProvider.ts` | 已实现 |
| 17 | `updateOrders` unsettle/winBalance | `uv.updateOrders` | `stores/accountStore.ts` | 已实现 |
| 18 | 粘贴多网关测速 | `AccountInfoView` | `AccountEditDialog.vue` | 已实现 |
| 19 | 扩展代发 GET/POST | `Zn` | `client/chrome-extension（Gamebet 协议代发）` | 已实现 |

## A8 API 路径

| 用途 | 方法 | 路径 |
|------|------|------|
| 欧赔采集 | GET | `/sports-service/sv/euro/odds?...` |
| 余额 | POST | `/member-service/v2/account-balance?locale=zh_CN&...` |
| 预检 | POST | `/member-betslip/v2/all-odds-selections?...` |
| 下单 | POST | `/bet-placement/buyV4?uniqueRequestId=...` |
| 拒单轮询 | GET | `/member-service/v2/my-bets?...` |
| 订单 | POST | `/member-service/v2/wager-filter?locale=zh_CN` |

## 有意未实现（changmen 后端无对应 API）

| A8 | 说明 |
|----|------|
| `Vt.saveOrders` | bundle 批量落库场馆订单；changmen 暂无 `Client_SaveOrders`，`updateOrders` 仅更新账号 `unsettle`/`winBalance` |

# A8 复刻：OB / IM / TF / PB / RAY / IMT / STAKE / IA

> 历史记录：损坏文字依据 Git `069518ce5f67`（`client/web/docs/A8_REPLICATE_8_PLATFORMS.md`）恢复，保留后续有效更新。原日期及勾选项表示当时状态；当前入口与规则以仓库 `AGENTS.md` 和 `LOCAL_DEV.md` 为准。

对照基线：`A8/index0706.js`。
changmen 实现：`client/packages/venue-browser/adapter/{platform}/`（`collect.ts` / `bet.ts`）、`server/backend/core/esport-api`；插件桥 `@/chrome-plugin/bridge.ts`。

---

## 用户中心「赛事采集」开关（重要）

**开关含义：是否把数据回传到服务器**（`API_SaveMatch` / `API_SaveBet`），**不是**是否在前端向场馆拉赔率。

| 层级 | 行为 |
|------|------|
| `collectStore.saveMatch` / `saveBets` | 开关关闭时直接 `return false`，不调后端 |
| 各平台 `client/packages/venue-browser/adapter/{platform}/` | **应常驻运行**（HTTP/WS/插件），继续写 `oddsStore`、刷新主列表 |
| `runtime/collectors.ts` | 不因开关关闭而 `stop` 采集器 |

对齐 A8 Pinia `Tf`：`saveMatch` / `saveBet` 内判断 `e.collect.get(platform)`。

---

## 复刻三模式（先认模式再改代码）

| 模式 | 平台 | 采集 | 下注 |
|------|------|------|------|
| **A** 场馆 HTTP/WS | OB、RAY、TF、IA、IMT | `Client_GetCollectPlatform` + 轮询/WS | 账号 `ACCOUNT` + `*Provider` |
| **B** A8 聚合 Socket | IM | `socketHub` 频道 `IM`，JWT=`localStorage.token` | 账号 + `imProvider` |
| **C** 浏览器插件 | PB、STAKE | 扩展代发 HTTP；Stake 另订频道 `Stake` | 账号 token + tabId + `*Provider` |

**共性**：采集凭证 ≠ 下注凭证。下注一律用「平台账号设置」里粘贴的 gateway/token。

---

## 总览

| 平台 | 采集 | 下注 | changmen 状态 | 复刻验收重点 |
|------|------|------|---------------|--------------|
| OB | HTTP `game/index`+`view` + MQTT `/esport/ws/OB` | `obProvider` | ✅ 主链已对齐 | 模式 P 验收、CollectConfig 开回传 |
| IM | A8 Socket `IM` | `imProvider` | ✅ 已对齐 | 登录 JWT、频道赔率 suffix 1/2 |
| TF | REST 30s + 赔率 WS | `tfProvider` | ✅ 已对齐 | `getTfA8CollectCredentials`、tf-authorization |
| PB | 扩展 GET（须有余额账号） | `pbProvider` | ✅ 需扩展 | 装插件、PB 账号刷余额、lineId |
| RAY | HTTP `/v2` + SC `/esport/ws/RAY` | `rayProvider` | ✅ 已对齐 | 后端写死 JWT，勿改用户 token |
| IMT | 快照 + Delta `mobilesitev2` | `imtProvider` | ✅ 已对齐 | gateway+token+已登录账号 |
| STAKE | GraphQL 30s + 频道 `Stake` | `stakeProvider` | ✅ 需扩展+tab | tabId、GraphQL 下注 |
| IA | HTTP 列表 + WS `/esport/ws/IA` | `iaProvider` | ✅ 默认凭证已补 | 空 token、ilustre gateway |

---

## 按平台：A8 怎么做 → changmen 改哪 → 怎么验收

### OB

| 项 | 内容 |
|----|------|
| A8 [可证实] | `UMe`：`getPlatform(OB)` → `game/index` → **saveMatch** → `game/view` → saveBets + fo；`token` 失效 → `$Me` 试玩写回；MQTT admin（与 platform token 无关） |
| 代码 | `client/packages/venue-browser/adapter/ob/*` | `client/packages/venue-browser/adapter/ob/bet.ts` |
| 凭证 | `platforms.json` OB；[changmen 扩展] 可 `syncObLogin` |
| 下注 | 粘贴 OB 账号 JSON → `ACCOUNT` |
| **parity 缺口** | — | 模式 P 下浏览器 saveMatch + 顺序灌盘 |
| 验收 | CollectConfig 开 OB → Network：`API_SaveMatch?OB` + `API_SaveBet?OB` + `game/index`/`view` + MQTT |

### IM

| 项 | 内容 |
|----|------|
| A8 | **不**拉场馆 HTTP 列表；`join room` → `IM`；`EZe` 写 `oddsStore` |
| 代码 | `client/packages/venue-browser/adapter/im/*` | `client/packages/venue-browser/adapter/im/bet.ts` |
| 凭证 | Socket：`localStorage.getItem("token")`（A8 登录 JWT） |
| 下注 | IM 账号 gateway/token → `imProvider` |
| 验收 | ① 登录后 Socket 连 `47.115.75.57` ② 见 `join room` / `IM` 推送 ③ 主列表 IM 盘有赔率 ④ 用 IM 账号下单 |

### TF

| 项 | 内容 |
|----|------|
| A8 | `UBe`：`getPlatform(TF)`；`/api/v8/events` + 赔率 WS；下注 `bYe` |
| 代码 | `client/packages/venue-browser/adapter/tf/*` | `client/packages/venue-browser/adapter/tf/bet.ts` |
| 凭证 | `Client_GetCollectPlatform` → `getTfA8CollectCredentials()`（可拉 A8 服或 env） |
| 验收 | ① `Client_GetCollectPlatform` 有 Gateway/Token ② 30s 轮询 events ③ WS 赔率更新 ④ TF 账号下单 |

### PB

| 项 | 内容 |
|----|------|
| A8 | `AQ`：须有 PB 账号且 `balance!==undefined`；`Zn.get` 扩展请求；`TQ` 缓存 lineId |
| 代码 | `client/packages/venue-browser/adapter/pb/*` | `client/packages/venue-browser/adapter/pb/bet.ts` |
| 凭证 | 采集：**有余额的 PB 账号**（非 platforms.json）；下注：同账号 |
| 验收 | ① 安装 Gamebet/A8 扩展 ② PB 账号粘贴并刷余额 ③ 采集开关开 PB ④ 下单带 lineId |

### RAY

| 项 | 内容 |
|----|------|
| A8 | `vQe`：**写死** `cfinfo.365raylinks.com` + Bearer JWT（不读 getPlatform） |
| 代码 | `client/packages/venue-browser/adapter/ray/*` | `client/packages/venue-browser/adapter/ray/bet.ts` |
| 凭证 | `router.js` + `devtools/platform-probes/ray/collect_credentials.js` 强制返回 A8 JWT |
| 下注 | RAY 账号自己的 gateway/token |
| 验收 | ① `Client_GetCollectPlatform(RAY)` 为 A8 JWT ② `/v2/match` ③ SC 频道 match ④ RAY 账号 `/v2/order` |

### IMT

| 项 | 内容 |
|----|------|
| A8 | `Pee`/`jQe`：`getPlatform(IMT)` + 已登录 IMT 账号；60s 快照 + Delta |
| 代码 | `client/packages/venue-browser/adapter/imt/*` | `client/packages/venue-browser/adapter/imt/bet.ts` |
| 凭证 | `resolveCollectSession("IMT")`：账号优先，否则 platforms.json |
| 验收 | ① IMT 账号有余额 ② `GetAllLiveEvents` / Delta ③ 主列表 IMT 赔率 ④ IMT 下单 |

### STAKE

| 项 | 内容 |
|----|------|
| A8 | `MQ`：等 `qs.tabId`（10×3s）→ GraphQL 各 sport → `saveMatch`/`saveBets` → 频道 `Stake`；下注 `rJe` 要 tabId |
| 代码 | `client/packages/venue-browser/adapter/stake/*` | `client/packages/venue-browser/adapter/stake/bet.ts` |
| 凭证 | 采集：`STAKE_ACCESS_TOKEN` 等；实时：A8 Socket；下注：账号 `x-access-token` + tabId |
| 验收 | ① 扩展 + Stake 标签页 ② 控制台无「未找到 Stake 标签页」 ③ GraphQL 快照 ④ Stake 账号下注 |

### IA

| 项 | 内容 |
|----|------|
| A8 | `wQe`：ilustre + 空 token + `Zn` HTTP + WS `/esport/ws/IA`；`CYe`：`mr.post`（Zn / PROXY） |
| 代码 | `ia/*`（`bet_transport.ts` = `mr.post`） | `ia/bet.ts` |
| 凭证 | 采集写死 `a8Collect`；下注用 IA 账号 gateway/token | |
| 验收 | ① 扩展已装 ② HTTP 列表 30s ③ WS（上游可用时）④ IA 账号 checkBet/playMore | |

---

## 环境 / 启动配置（后端）

| 平台 | 建议 |
|------|------|
| OB | `OB_*` 或 `syncObLogin` |
| TF | 自动 `getTfA8CollectCredentials` 或 `TF_GATEWAY`/`TF_TOKEN` |
| RAY | 无需 env（写死） |
| IA | 无 env 时用 A8 默认；可覆盖 `IA_GATEWAY` / `IA_TOKEN` |
| IMT | `IMT_GATEWAY`/`IMT_TOKEN` 或 feed session |
| PB | PB feed session 或账号余额 |
| STAKE | `STAKE_ACCESS_TOKEN` + 浏览器扩展 |
| IM | A8 登录即可（Socket JWT） |

重启后端后检查 `data/esport/platforms.json`。

---

## 账号粘贴（8 平台通用）

`AccountEditDialog` → 快速填充 → base64 JSON：

```json
{
  "provider": "OB",
  "token": "...",
  "referer": "...",
  "gateway": "https://..."
}
```

多网关 PB 可为 `"gateway": ["url1","url2"]`（PB 会测速选最快）。

---

## 推荐复刻顺序（联调）

1. **OB** — 主盘 + MQTT
2. **IM** — 确认 A8 Socket 有赔率
3. **RAY** — 写死凭证是否通
4. **TF** — GetCollectPlatform + WS
5. **IMT** — 账号 + Delta
6. **IA** — 默认 gateway + 空 token
7. **PB** — 扩展 + 余额
8. **STAKE** — tabId + GraphQL + 下注

同屏走查表：[A8_WALKTHROUGH_CHECKLIST.md](./A8_WALKTHROUGH_CHECKLIST.md)

---

## 代码索引

| 平台 | 采集 | 下注 | 文档 |
|------|------|------|------|
| OB | `client/packages/venue-browser/adapter/ob/` | `client/packages/venue-browser/adapter/ob/bet.ts` | [OB.md](./platforms/OB.md) |
| IM | `client/packages/venue-browser/adapter/im/` | `client/packages/venue-browser/adapter/im/bet.ts` | [IM.md](./platforms/IM.md) |
| TF | `client/packages/venue-browser/adapter/tf/` | `client/packages/venue-browser/adapter/tf/bet.ts` | [A8_TF_LOGIC_PARITY.md](./platforms/A8_TF_LOGIC_PARITY.md) |
| PB | `client/packages/venue-browser/adapter/pb/` | `client/packages/venue-browser/adapter/pb/bet.ts` | [A8_PB_LOGIC_PARITY.md](./platforms/A8_PB_LOGIC_PARITY.md) |
| RAY | `client/packages/venue-browser/adapter/ray/` | `client/packages/venue-browser/adapter/ray/bet.ts` | [RAY.md](./platforms/RAY.md) |
| IMT | `client/packages/venue-browser/adapter/imt/` | `client/packages/venue-browser/adapter/imt/bet.ts` | [IMT.md](./platforms/IMT.md) |
| STAKE | `client/packages/venue-browser/adapter/stake/` | `client/packages/venue-browser/adapter/stake/bet.ts` | [Stake.md](./platforms/Stake.md) |
| IA | `client/packages/venue-browser/adapter/ia/` | `client/packages/venue-browser/adapter/ia/bet.ts` | [IA.md](./platforms/IA.md) |

共享：[A8_COMPARE_ALL_PLATFORMS.md](./platforms/A8_COMPARE_ALL_PLATFORMS.md)、`client/packages/venue-browser/adapter/shared/socket/hub.ts`、`src/chrome-plugin/bridge.ts`

---

*IA 默认凭证：`devtools/platform-probes/ia/collect_credentials.js`（A8 空 token）。*

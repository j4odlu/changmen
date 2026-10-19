# RAY 采集

> **A8 对照**（Token / 采集 / 下注）：见 [A8_COMPARE_OB_RAY.md](./A8_COMPARE_OB_RAY.md#ray-平台)。

## 入口

`ray/index.ts` → `startRayCollector()`

## 双通道

| 通道 | 间隔 | 作用 |
|------|------|------|
| HTTP `match` 列表 | 30s | `saveMatch` + 每场 `loadRayBets` → `saveBets` |
| SocketCluster 源站 | 实时 | `source === "odds"` 时更新 `oddsStore` |

浏览器 **直连** `wss://cfsocket.365raylinks.com/socketcluster/` 频道 `match`（`ray/realtime.ts`，A8 写死 JWT）。不经 `/esport/ws/RAY` relay。

## 开赛时间

```ts
const horizon = Date.now() + 3600_000;
start < horizon  // 毫秒
```

## 盘口

- 只采集赔率组名匹配 **`/^获胜者$/`** 的 market（`WIN_GROUP`）
- `rayStage(map)`：`final` → Map 0，否则数字地图号

## 赛前异常比赛关闭

[changmen 扩展] 客户端复用现有 `/v2/odds` 响应，在同一次 `API_SaveBet` 的可选 `matchResult` 字段透传原生状态、时间、BO、队伍及地图胜负记录，不判断异常、不新增请求。RAY WIN 展示仍沿用原来的逻辑。

matcher 的 `ray_match_risk.js` 统一判断：RAY 原生状态为赛前、开赛时间尚未到、BO3/5/7 的前面每张地图均明确未出赛果，而最后一张地图有成对的已结算胜负。缺失、冲突、取消或进行中的数据不触发。命中一次即保存，不随后续正常响应、开赛或服务重启自动解除。

记录保存于服务端持久存储目录 `ESPORT_DATA_DIR/ray_match_risks.json`。赛事下发出口调用 matcher 的过滤函数，将异常整场从 `Client_GetMatchs` 返回值排除，所有客户端在下一次原有列表刷新时移除该比赛。记录同时保留已关联的本站比赛 ID 和平台来源 ID，避免重新合场后恢复。内部合场记录、已有订单及其收尾保持原流程；客户端不新增关闭变量或下单检查，也不撤销已开始的提交。

## 队徽

静态 CDN：`https://statics.freestaticsasia.com` + `team_logo` 路径（`rayLogo`）。

## 凭证

| 用途 | changmen | A8 原版 |
|------|----------|---------|
| **采集** | [`a8Collect.ts`](./a8Collect.ts) 内联 `t`（与 `devtools/platform-probes/ray/collect_credentials.js` 同步）；**不**调 `Client_GetCollectPlatform` | 插件 `bQe` 内写死 gateway + JWT + games |
| **下注** | 剪贴板 → `ACCOUNT` → `rayProvider` | 同左 |

`Client_GetCollectPlatform(RAY)` 仍返回同一 JWT（供探针/其它工具）；采集器与 A8 一样只读内联对象。

## 子模块

| 文件 | 说明 |
|------|------|
| `ray/a8Collect.ts` | A8 `bQe` 写死 gateway/token/games/betName |
| `ray/scClient.ts` | SocketCluster；dev 经 backend relay（`3560` / `3456`） |
| `ray/http.ts` | 采集 GET（直连 gateway） |
| `ray/paths.ts` | API 路径 `/v2/...` |
| `ray/index.ts` | 轮询 + SC 消费 |

后端 Node 探针：`devtools/platform-probes/ray/collect_credentials.js`、`server/backend/proxy/ray_http_proxy.js`。

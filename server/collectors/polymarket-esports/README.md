# polymarket-esports (`@changmen/polymarket-esports-collector`)

VPS 守护进程：Polymarket **Gamma + CLOB /prices discovery（唯一权威）** → `platform_*` + 本机 `polymarket_market_index.json`。解析见本包 `parse.js` / `api.js`。

**职责一句话**：只有 VPS 写 Polymarket 电竞库；浏览器只吃 Index → Market WS → fo（可经 VPS 或直连官网；**不**镜像列表 discovery）。

对齐官方文档：

- [events/keyset](https://docs.polymarket.com/api-reference/events/list-events-keyset-pagination)（cursor，非 offset）
- [GET /sports](https://docs.polymarket.com/api-reference/sports/get-sports-metadata-information)
- [GET /sports/market-types](https://docs.polymarket.com/api-reference/sports/get-valid-sports-market-types)
- [POST /prices](https://docs.polymarket.com/api-reference/market-data/get-market-prices-request-body)（`side: SELL` = 买入 ask）
- [Fetching markets](https://docs.polymarket.com/market-data/fetching-markets)（列盘主路径 `closed=false`）
- 实时顶价仍走 Market WS（浏览器 / hub），**不**用本进程 HTTP 当实时源
- 手续费：以官方 `feeSchedule` / CLOB `getClobMarketInfo().fd` 为准（Sports taker feeRate 现为 **0.05**；见 [Fees](https://docs.polymarket.com/trading/fees)）

## 采集逻辑（一轮）

1. `GET /sports` → 电竞 `series_id`（缓存 1h）
2. `GET /sports/market-types` → 与 `moneyline`/`child_moneyline` 求交（缓存 6h；可用 env 追加）
3. `GET /events/keyset`（官方 `closed=false` + `series_id` + cursor）：
   - **主 pass**：`start_time` ∈ [now-6h, now+1h]
   - **补 pass**：`live=true`（开赛早于 6h 但仍标 live 的长局）
   - **本地**：丢弃 `ended===true` / market `archived`；活跃赛事内的已关闭地图保留以查询官方结果
4. 类型 allowlist → 双 token / 可解析 / 开赛 ≤ now+1h
5. [changmen 扩展] 对数量受限的候选市场读取 CLOB `GET /markets/{condition_id}` 的 `tokens[].winner`。比赛卡 WIN 只认单一官方胜方，不用价格判赢，也不复用订单输赢机制；失败时不生成 WIN。整批 10 秒截止、最多 8 个并发。已关闭且官方胜方明确的地图以 Locked/零赔率保留；未确认的关盘不生成盘口。
6. `POST /prices` `SELL` 种子价（只查未关闭盘口）
7. 按 SourceMatchID 整场截断（默认最多 400 盘；官方查询前也执行上限）
8. **写库**：upsert 本轮场次 + bets；**prune** 仅 `ended/closed` ∪ `synced_at` 过旧（**不**按 start 窗外删；窗只约束拉取体积）
9. 写 MarketIndex（与 DB 同生命周期：空窗不硬清空，只剔 ended）；浏览器禁止 `API_SaveMatch` / `API_SaveBet` / `API_SaveLiveTimer`

## 运行

| 环境 | 命令 |
|------|------|
| 开发 | `npm run polymarket-collector` |
| 生产 PM2 | `changmen-polymarket-collector` |

| 变量 | 默认 | 说明 |
|------|------|------|
| `POLYMARKET_COLLECTOR_INTERVAL_MS` | `60000` | 周期 |
| `POLYMARKET_COLLECTOR_WRITE_PLATFORM` | `1`（live） | `0`/`false` → shadow（只写 Index） |
| `POLYMARKET_COLLECTOR_EXTRA_MARKET_TYPES` | 空 | 逗号分隔额外类型（须在官方 list 内） |

## 安全写库（live）

| 情况 | 行为 |
|------|------|
| HTTP 抛错 | 本轮不写 |
| 有 typed ML 但解析全失败 | skip，不写不 prune |
| 窗内无 ML | Index 剔 ended 保留其余 + prune(ended∪synced 过旧)，**不**硬清空 |

索引：[collectors/README.md](../README.md) · [PRODUCTION_DEPLOYMENT.md](../../../PRODUCTION_DEPLOYMENT.md)

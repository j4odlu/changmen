# polymarket-esports (`@changmen/polymarket-esports-collector`)

VPS 守护进程：Polymarket **Gamma + CLOB /prices discovery（唯一权威）** → `platform_*` + 本机 `polymarket_market_index.json`。解析见本包 `parse.ts` / `api.ts`。

## TypeScript 实现与兼容入口

`index.ts`、`api.ts`、`parse.ts`、`loop.ts`、`market_index.ts` 是实现源码，`types.ts` 定义采集、写库和索引契约。Node 24 原生擦除类型运行，无需生成 dist；`tsconfig.json` 启用 strict、noEmit、erasableSyntaxOnly。

同名 `.js` 仅转发到 `.ts`，保留 PM2 的 `index.js`、包 exports 和旧导入路径，因此部署与回滚仍使用原启动配置。上线须连同 TS 源码发布。

根目录执行 `npm run typecheck --workspace=@changmen/polymarket-esports-collector` 可单独检查类型；`npm test --workspace=@changmen/polymarket-esports-collector` 先检查类型，再跑解析、API、写库安全、索引与迁移测试，也被根目录后端测试链调用。数据库采集接口统一由 `rds/collector_contracts.d.ts` 维护，`legacy-modules.d.ts` 仅引用它；storage 在自身 JS 文件旁维护声明，两套 PM 采集器共用。使用方无需额外把声明加入自己的 tsconfig；迁移测试会单独编译包的公开导出验证这一点。

`typescript-runtime-baseline.json` 记录本次迁移前（已集中游戏配置）的运行代码摘要。迁移测试核对类型擦除后的实现与旧实现一致，并验证 JS 转发和原生 TS 启动。它不替代独立的经典 FOK 固定基线。

TS 开发依赖与 API 类型依赖在 workspace 记录中声明。`scripts/verification/pm-collector-typescript-metadata.mjs` 与 `pm-sports-typescript-metadata.mjs` 按阶段精确逆转已登记的增量，继续核对完整历史锁文件。额外改动、SDK 漂移和历史基线替换仍会失败。

**职责一句话**：只有 VPS 写 Polymarket 电竞库；浏览器只吃 Index → Market WS → fo（可经 VPS 或直连官网；**不**镜像列表 discovery）。

## 队伍身份与盘口选项

[changmen 扩展] 有效的 Gamma `event.teams[].id` 用作平台队伍 ID，`teams[].name` 用作比赛及 Teams 队名；盘口 `HomeName` / `AwayName` 仍来自 `outcomes`，与同下标 token、价格绑定。不会按 `teams` 数组位置或 `ordering` 重排盘口：先按官方队名/别名唯一对应选项，只有一侧名称对应时才将另一支队伍配给剩余选项。身份重复、冲突或两侧都无法对应时跳过解析，不猜测选项归属。官方主客标记与盘口顺序可能不同，matcher 原有朝向处理保持。

Gamma 暂缺 teams 时跳过该场不完整响应，保留已有快照，不用空 ID 覆盖旧身份；本次不加入运行时映射迁移。部署切换前需核对旧队名 ID 对应的已有队伍映射。

官方依据：[队伍主客标记](https://docs.polymarket.com/market-data/discover-markets#identify-home-and-away-teams)、[盘口名称与 token 对应](https://docs.polymarket.com/market-data/market-details#market-outcomes)。

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

[changmen 扩展] 官方赛果补采与行情 discovery 分开：每轮先从 Index 的 `outcomeEntries` 补查缺失胜方，再跑原有行情采集。`ended`/`closed` 退出行情列表后，赛果仍保留；存档只供展示，不加入 `assetIds`、不写报价或 `platform_*`。每轮最多查 48 个市场，沿用 CLOB 8 并发/10 秒截止；优先查询最久未检查的市场。开赛 6 小时内每分钟重试，24 小时内每 5 分钟，之后每 15 分钟；未结算保留 7 天，官方结果保留 30 天，重启沿用补采进度。官方胜方不会因下一轮缺值或查询失败而丢失。前端 WIN 仍只认 `tokens[].winner`；待结算仅展示在已打完的地图，未打的决胜局和当前进行中的地图不标记。

| 情况 | 行为 |
|------|------|
| HTTP 抛错 | 本轮不写 |
| 有 typed ML 但解析全失败 | skip，不写不 prune |
| 窗内无 ML | Index 剔 ended 保留其余 + prune(ended∪synced 过旧)，**不**硬清空 |

索引：[collectors/README.md](../README.md) · [PRODUCTION_DEPLOYMENT.md](../../../PRODUCTION_DEPLOYMENT.md)
### 旧队伍 ID 的一次性切换

历史 `game:name` 队伍 ID 使用 `rds/maintenance/polymarket_official_team_plan.js` 生成逐条核实的迁移清单，再执行 `rds/maintenance/migrate-polymarket-official-team-ids.mjs --plan=/absolute/plan.json` 只读核验；加 `--apply` 才写入。该维护工具不进入采集或 matcher 运行链路。

先通过 GitHub Actions 发布官方队伍 ID 采集器，确认现网采集已使用官方 ID，再短暂停止 PM HTTP 采集进程、刷新核对清单并执行迁移，完成后恢复采集。不得在旧采集器仍会写回名称 ID 时直接迁移。写入前落盘备份，事务内保留原 `gb_team_id`，只替换 PM 外部队伍标识及赛事队伍资料；合场关联、盘口、赔率及 token 保持原值。未识别且无可靠对应的历史记录保留，已识别记录或现有官方映射出现冲突时整次拒绝执行。

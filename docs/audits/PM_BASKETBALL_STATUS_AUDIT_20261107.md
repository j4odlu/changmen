# PM 篮球状态完整链路检查（2026-11-07）

[changmen 扩展] 首次检查为只读检查和方案取证，没有改动采集、显示、合场或生产数据，没有 push 或部署。统计是台北时间 2026-11-07 04:06:58 的数据库快照；外部接口随后分批查询，不能视作完全同时的截面。后续经用户要求完成的本机修复见下一节。

## 后续修复：后合场状态承接

[changmen 扩展] 用户随后明确要求修复状态承接 bug，本机代码已在 `rds/rds/client_matches_store.js` 的合场事务中接入 `inheritPlatformPmSports`。它按当前 PM event ID 承接 `platform_matches.pm_sport`，仅填充合场状态的 SQL NULL，涵盖新建、既有缺状态及结束行；整个快照原样复制，已有状态和并发新 WS 均保留，随原有提交后发布路径生效。不需要新的 PM HTTP 请求、WS 连接、轮询或 schema 维护。

隔离 PostgreSQL 已验证：未匹配时状态先到、后续新建合场、已有缺状态、结束行、已有 WS/Gamma/legacy 状态保护、精确事件与平台身份、无效状态排除、原始时间和比分方向、真实行锁竞争下的新 WS 保护、事务回滚，以及平台状态列尚未维护时的兼容。另有事务接入/失败回滚单测。该修复不补造本文样本中上游缺失的 12 场状态。没有 push、部署或生产数据修复。

修复验证：`node scripts/testing/platform-pm-sport-postgres.mjs`、`node scripts/testing/phase2-postgres.mjs` 通过；相关 3 个 Vitest 文件共 8 项通过；后端范围 `npm exec -- turbo run test --filter=./server/**... --force` 为 13/13 任务通过。边界、client-core、API 契约与 catalog 检查通过。统一 `npm run check:change` 仍未通过：工作区原有的 `client/packages/client-core/src/bridge/oddsAccess.ts`、`client/packages/venue-browser/polymarket/markets/collect.ts`、`client/web/src/stores/oddsStore.ts` 命中电竞冻结门禁；本次没有改动这些文件，没有放宽冻结策略或宣称完整门禁通过。完整日志保留在本机 `output/pm-basketball-status/fix-*.log`。

发布前复核：未发现新增业务逻辑缺陷。再次核对精确 PM 身份、仅补 SQL NULL、来源/原始时间保留、事务失败回滚、并发 WS 保护、比分方向、sticky ended 及原有提交后发布路径。相关 Vitest 17 项与 Node 广播 4 项通过；状态承接 PostgreSQL 专项、matcher phase2 PostgreSQL、路由编译与边界检查再次通过。五组隔离 PostgreSQL 兼容演练全部通过，验收报告 `passed=true / sourceStable=true`，未写生产数据库。用户已授权检查通过后提交、push、部署；提交范围限定为本次状态承接及检查证据的 7 个文件，其他工作区改动不纳入。正式发布仍由 GitHub Actions 对精确提交执行适用门禁及制品/运行健康验收；本文不提前声明部署成功。

## 结论

不能把“Gamma 单场接口缺字段”直接扩大成“PM 没有比赛状态”。本次进一步检查了 PM 官网实际加载的 Sports Worker、官网联赛接口、Gamma 的单场/slug/game_id 查询和游戏元数据接口。

当前收录的 21 场篮球中，9 场已有有效 WS 状态，12 场未知；这 12 场的单场 Gamma 响应全部缺少有效比赛状态字段。其中 9 场属于官网联赛配置 `provider: "none"` 的联赛，另 3 场是配置了 `sportsdataio` 的 NCAA 场次。已合场的 5 场全部落在前一组，因此用户看到的合场列表尤其明显。

找到的新入口是官网 `/api/sports/league-events`。它确实提供 `games[slug].gameState`，但这批未知比赛的 `not-started / false / false / 0-0 / NS` 是官网从缺字段的 event 构造出来的默认值，不能作为真实赛程状态的补充。直接接入可以使文案与官网一致，却不能证明比赛实际尚未开始。

没有证据证明这些联赛永久不支持 Sports WS，也没有找到一个已验证、能补齐本批 12 场真实状态的 PM 隐藏接口。应把这个限制与已经证实的入口、字段和可修复缺口分别记录。

## 当前数据

逐场事件 ID、原始字段是否存在、数据库状态、官网 games 值和联赛配置均见 [evidence.json](./2026-11-07-pm-basketball-status/evidence.json)。

| 分组 | 场数 | 观察结果 |
| --- | ---: | --- |
| 已有有效状态 | 9 | 均为 CWBB，来自 Sports WS，8 场 Final、1 场 InProgress |
| 未知且官网 provider 为 none | 9 | 欧篮联 4、VTB/德篮/法篮/KLS/PLK 各 1 |
| 未知且官网 provider 为 sportsdataio | 3 | CWBB 2、CBB 1；包括两个登记开赛时间尚未到达的场次，不能据此改写状态 |
| 已合场 | 5 | 欧篮联 4、法篮 1；平台状态和合场状态都为空 |

具体示例：

- `1288615`：Olympiacos B.C. vs. KK Crvena Zvezda，Gamma gameId `5983047`。Gamma 没有 live、ended、status、gameStatus、score；官网 games 显示 not-started、0-0、NS。
- `1312647`：Boulazac vs. BCM Gravelines Dunkerque，Gamma gameId `6145125`。同样缺少直接状态，官网给出同组默认值。
- `1287169`：Avtodor vs. Unics Kazan。Gamma 已 closed，但缺直接状态；官网仍给出 not-started、0-0、NS。盘口关闭与官网默认值都不能单独证明比赛进度。
- `1288627`：Indiana State Sycamores vs. Seton Hall Pirates (W)。Gamma 直接给出 ended=true、score=56-74、period=FT；数据库有 WS Final，官网 games 也为 finished。此对照说明已接入的有效状态能够被保存。

## 官网入口与生成规则

官网入口来自实际下载的页面代码，而非凭空假设：

```text
https://polymarket.com/api/sports/league-events
  ?seriesId=10371
  &sportSlug=euroleague
  &currentSlug=euroleague-olympiac-zvezda-2026-11-06
  &locale=en
```

响应包括 events、games、teams、sections、gameIdToSlug 等。按本批比赛涉及的 8 个联赛分别查询，均返回 HTTP 200；当前未知的 12 场在 games 中均给出默认未开赛状态。某些已结束 CWBB 不在联赛列表内，列表不是单场终态查询的替代品。

官网前端对应代码：

```js
live: !!event.live
ended: !!event.ended
score: event.score ?? "0-0"
period: event.period ?? "NS"
```

`gameState` 分支依次检查 period=POST、ended、live，其余直接返回 NotStarted。这些代码是官网客户端逻辑的直接证据；不能仅凭客户端 bundle 断言其不可见服务端的全部实现。不过，实时 league-events 响应与这组默认规则吻合。

原始片段和对应资源 URL 保存在 evidence.json。资源会随官网发布变化。

官网 [Sports Worker](https://polymarket.com/_next/static/immutable/chunks/0rsc5n-7k2g1p.js) 使用 `wss://sports-api.polymarket.com/ws`，与现有 VPS 采集器一致。它没有显示出另一个篮球专用分数订阅：连接后接收全量增量消息，处理 PING/PONG，然后按接收顺序批量交给 store。

官网 [联赛配置资源](https://polymarket.com/_next/static/immutable/chunks/443ln_z7q9d07.js) 中，NBA、CBB、CWBB 为 sportsdataio；本批的 euroleague、bkvtb、bkbbl、bkfr1、bkkls、bkplk 为 none。该配置是官网功能的线索，不能单独证明 Sports WS 服务端永久不覆盖某联赛。

## 其他接口核查

| 接口 | 结果 | 能否解决本批未知 |
| --- | --- | --- |
| Gamma `/events/{id}` | 逐场 21/21 成功；9 场有直接状态，12 场缺失 | 与当前采集结果一致 |
| Gamma `/events/slug/{slug}` | 欧篮联对照场成功，未发现补充状态 | 否 |
| Gamma `/events?game_id=5983047` | 返回对应欧篮联事件，未发现补充状态 | 否 |
| Gamma `/games?ticker=...` | 返回 teams、sport、ordering、盘口类型 | 元数据，不是比分表 |
| Gamma `/games?sport=euroleague` | 返回 sport、ordering | 元数据，不是比分表 |
| Sports API `/games`、`/games/{id}`、`/openapi.json` | 本次请求均 404 | 未发现此类公开 REST 入口 |

官方 [Gamma OpenAPI](https://docs.polymarket.com/api-spec/gamma-openapi.yaml) 声明了可空的 event.gameStatus；当前转换器只读取 event.status。此次 21 场样本的 gameStatus 均不存在，因此该兼容缺口不是当前 12 场未知的解释。接入前应取得真实字段取值及与 live/ended 的冲突样本，避免臆造枚举。

官方 [Sports Stream](https://docs.polymarket.com/market-data/realtime-data#sports-stream) 描述的是状态变化时推送；连接成功不等于会重放每场完整状态。短期未观察到某联赛消息，不足以宣布该联赛永久不支持。

本次另做了 45 秒和 300 秒的只读 WS 观察，分别收到 34 条和 199 条比赛消息；两个窗口均没有篮球消息，也没有本批 21 个篮球 gameId。长窗口按官网 Worker 的方式发送大写 PING/PONG，并带官网 Origin；短窗口按现有采集器回复小写 pong。两次观察不同时，不能当作心跳方式的严格对照实验；它们只说明观察期间数据流有比赛更新，未验证到本批篮球的增量状态。

## 本地代码链路检查

1. `gamma_map.ts`：按共享 discovery 查询、时间窗为过去 6 小时至未来 1 小时、closed=false；缺状态时不制造未开赛。
2. `index.ts / resolve_match.ts`：Sports WS gameId 经 Gamma 索引补 event ID，再关联已收录的平台场次和 client match；没有证据显示本批 5 场是关联丢失，因为对应平台状态本身也为空。
3. `event_states.ts / platform_pm_sport.js`：有效状态独立保存到 platform_matches，未合场也能保存；当前 9 场 CWBB 证明这条路径正在工作。
4. `sport_state.ts / pm_sport_store.js`：同场串行、WS 优先、去重；已保存 WS 不被 Gamma 覆盖。
5. matcher 右栏从平台状态读取，中栏和用户页从合场状态读取；当前 5 场两个位置都为空，显示层没有藏掉现有有效快照。
6. `pmSportDisplay.ts / pm_match_status.js` 已识别 NBA/CBB 的 Scheduled、InProgress、Final、F/OT 及异常状态。本批问题无法通过再加一次 Final 映射消除。

还需修复或验证的可靠性缺口，不能冒充本批主因：

- **后合场状态承接**：未合场时保存的 platform_matches.pm_sport，没有被当前 linked Gamma poll 主动回填到新合场。若合场后不再收到 WS，终态可能留在平台行，而合场仍为空。实施时应按同一 event ID 承接原始快照时间，并原子拒绝旧快照覆盖新状态。
- **已关闭事件的身份兜底**：keyset 和 game_id 首次查询都带 closed=false，最终消息在索引未命中时可能无法找到事件；markets 兜底不保证每种状态都可用。应以具体终态样本验证后增加精确的 closed 事件查找，保留 gameId 相等检查。
- **WS 连接活性**：当前处理小写 ping，但没有独立的无消息 watchdog。可兼容大小写心跳并增加断线/无数据监测；它能改善恢复，不能制造未提供的比分。
- **Gamma 全局索引分页上限**：每次最多 3×500，且只查 narrow window；需记录游标是否耗尽及期望事件覆盖率，不能仅凭“索引刷新成功”判断所有事件已覆盖。

## 可落地的方法与边界

**保持真实 PM 比赛状态的方案**：继续以 Sports WS 和 Gamma 直接字段为依据，补上后合场承接、终态身份查找和连接活性监测；新增按 event ID 的缺失原因/快照来源/最后接收时间诊断。官网 league-events 用于交叉核对，不能把它的默认 NotStarted 写入比赛终态链路。这能修复状态遗漏，但不能保证覆盖本批全部未知。

**仅要求与 PM 官网显示一致的方案**：可以使用 league-events 的 games 状态，但必须明确标记默认/未核实状态，不能把默认 0-0 当作已观测比分，也不能驱动合场归档、结算或交易决策。这改变展示口径，不等于补齐实时比赛状态。

**要求覆盖这些联赛的真实开赛、节次、比分和结束**：当前证据支持的补全方法是以 PM event 的 resolutionSource 指向的官方联赛赛程/比分为补源，先覆盖 4 场欧篮联和 1 场法篮，再扩展其余联赛；单独记录来源、源赛事 ID、更新时间、映射依据和置信度，不能冒充 PM 原生推送。本次没有接入或写入任何此类补源，也没有获得用户选择该方案的确认。

## 验证和限制

已运行 `npm test --workspace=@changmen/polymarket-sports`：strict TypeScript 通过，63 项测试通过、0 失败；8 项历史源码等价审计按日常规则跳过，包含的原生启动/WS/写库/广播隔离测试通过。没有因为本次文档取证改动而运行整仓既有未提交代码的发布验收。

原始 Gamma、官网接口和 JS 资源保留于本机 `output/pm-basketball-status/`；仓库内 evidence.json 为不含凭证的精简逐场证据。浏览器控制工具初始化失败，因此官网证据来自公开 HTTP 响应、服务端渲染 HTML 及公开前端资源，未宣称完成交互式浏览器抓包。

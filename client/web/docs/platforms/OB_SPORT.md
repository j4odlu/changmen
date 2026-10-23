# OB 体育（熊猫试玩）实时机制

> **不是电竞 OB。** 电竞采集走 MQTT + `game/index`，见 [OB.md](./OB.md)。  
> 本文只记 **官网熊猫体育 PC 试玩** 如何拉列表、订推送、更新盘口；以及 changmen 足球页如何对齐。

标注：

| 标签 | 含义 |
|------|------|
| **[官网可证实]** | 试玩站 HTML `BUILDIN_CONFIG`、worker `ws-worker-*.js` 常量/逻辑，或 2026-09-08 试玩页 WS 抓包 |
| **[changmen 实现]** | 足球 Tab 已接线的行为 |
| **[changmen 扩展]** | 官网有、足球页故意不接或未接 |

抓包时前端包版本：`BUILD_VERSION=2026-09-01-19-12-40`，`TAG=shiwan.newpc.2026.06.10.01`，壳 `https://user-pc-new.dbgaming.com`。路径随发版会变，协议字段以下表为准。

---

## 1. 试玩是什么

官网「立即試玩」不是九游商户壳，也不是电竞 `djtop-capi` demo。

**[官网可证实]** 流程：

```text
GET https://api.dbsporxxxw1box.com/yewu6/user/tryPlay?lang=en&terminal=PC
  → { token, loginUrl, domain, userName }
  → 打开 https://user-pc-new.dbgaming.com?token=<hex>&gr=common
  → hash 清 query 后 token 在 sessionStorage（TY_SDK_TOKEN / token）
```

| 项 | 值 |
|----|-----|
| 试玩 API | `/yewu6/user/tryPlay` |
| HTTP 业务前缀 | `yewu11`（`API_PREFIX_JOB`） |
| 赔率推送前缀 | `yewuws2`（`API_PREFIX_WBSOCKET`） |
| 消息中心推送 | `yewuws4`（与盘口无关） |
| Token 形态 | 16+ 位 hex，不是电竞纯数字 token |

**[changmen 实现]** `obSportTrial.ts` 拉 tryPlay；会话只写本机 `localStorage`（`obSportSessionLocal`），禁止写入电竞 `platforms.json` / `ACCOUNT`。Chrome 扩展 `ob-entry.js` 从 URL 或 storage 抄体育凭证。

页面加载了 `mqtt.min.js`，**体育盘口不走 MQTT**。赔率通道是 JSON WebSocket `/yewuws2/push`。

---

## 2. 分层（官网 = changmen 应对齐的模型）

```text
HTTP（/yewu11/…PB）
  赛程 + 盘口快照：有哪些 mid、hpid、oid、初始价、线
        ↓
WS  wss://{api origin}/yewuws2/push?requestId={token}
  心跳 C0
  订阅 C8（按 mid + hpid）
  推送 C105 改价/锁/线；C102/C103 时钟比分；C303 玩法集合变了再 HTTP
```

**没有「每 1s/3s 轮询赔率」。** 价是服务端有变动就推。HTTP 只负责结构和漏订补偿。

足球菜单 **[官网可证实]**（侧栏 euid，changmen 已写进 fetch）：

| 菜单 | euid | 含义 |
|------|------|------|
| 1011 | `30002` | 滚球足球 |
| 1012 | `3020101` | 今日/早盘足球 |
| 运动 | `csid=1` | 足球 |

---

## 3. HTTP

**[官网可证实]** 列表/盘口 PB（与试玩 Network 及 `structureTournamentMatches` 路径一致）：

| 路径 | 用途 |
|------|------|
| `/yewu11/v2/w/structureTournamentMatchesPB` | 赛程 |
| `/yewu11/v1/w/structureMatchBaseInfoByMidsPB` | 按 mid 批量底价 |
| `/yewu11/v1/w/getMatchBaseInfoByOddsPB` | 单场详情全玩法 |

请求头要点：`requestId=token`、`lang=en`、`request-code={"panda-bss-source":"2"}`、`checkId=pc-…`。

**[changmen 扩展]** 足球板主会话默认 `tryPlay?lang=en`（队名随赛程/赔率一次到位）。中文队名另开 `tryPlay?lang=zh` 旁路按 mid 拉 `mhn`/`man`，板卡显示 `Home (主队) vs Away (客队)`；不写 `changmen.sportOb.session`，不订 `yewuws2`。旧中文 token 配 `lang=en` 会 `0401038`，拉表前会自动换英文试玩。对上身后，跟单再对 **全场/半场 进球大小、均势独赢、让球**。让球：POD `points` 是被降一侧的盘，OB `Line` 是主队 `hv`，主客相反时翻号。欧洲让球 1X2、角球/罚牌不算。对上盘后用板上 oid 读 `sportOddsStore` / `obSportLiveStore`（与格子同源：有缓存用 live 含锁盘 0，否则 HTTP），再和票上最低 OB 比「够/不够/锁盘」。点跟单票会清筛选、强制挂懒加载盘口，滚到那场/那格并高亮；命中仍标猜测。对上场和盘的跟单票才进浮窗并一直留下，标已下/未下；时效只挡自动下单。下单走侧栏 **OB 下注账号** 里的体育 token（`yewu13` 预检 `queryBetAmountPB` + 提交 `betPB`），采集仍用本机试玩会话。**自动默认关**。禁止写电竞 `fo`、禁止电竞 `/game/bet` / `placeValueBetOrder` / `mainBetLoop`。

**[changmen 实现]** 足球页 Axios 直连 `yewu11`（`obSportFootballFetch.ts`，与电竞 OB `directGet` 同路），不经 Chrome 扩展、不经 VPS、不写电竞 `client_matches`。2026-09-08 预检：`Access-Control-Allow-Origin: *`，允许头含 `requestId` / `lang` / `checkId` / `request-code`。足球 store 默认 **30s** 再拉快照。

[changmen 扩展] 足球 HTTP 实现按职责拆分，公开入口仍为 `runtime/obSportFootballFetch.ts`：

- `obSportFootballResponse.ts`：赛程袋、电子赛事过滤、赔率行合并与详情解析；只处理传入数据，保留原有 Map 和详情行的引用语义。
- `obSportFootballDto.ts`：稳定 ID、队名与占位标题、列表 DTO、六类主盘及盘口去重；时钟由宿主传入，读取次数和计算位置保持。
- `obSportFootballFetch.ts`：请求头、英文会话、请求顺序、限流退避、详情补查、中英文名称缓存、列表单飞与 10 秒内存缓存。

离线对照覆盖旧实现的响应、DTO 及请求/缓存时序，不需要真实 token 或连接场馆。

场次集合对齐试玩同一套菜单（滚球 `30002` + 今日 `3020101`，`csid=1`）。相对试玩只故意裁三处：

| 保留的差异 | 说明 |
|------------|------|
| 时间窗口 | 未开赛未来 **2h** + 开赛后 **4h** 滚球（今日菜单场次太多） |
| 盘口显示 | 六列 **全场/半场 独赢 + 让球 + 大小**（试玩列表只画让球/大小；点进详情才有波胆、角球等） |
| 电子赛事 | 试玩足球菜单里仍是 `csid=1`，但 `me`/`tme`=1 或联赛名 `VS-` / `EAFC` / `PANDA独家` 的场不进足球页（`mvs` 是视频位，不是电子赛） |

其余对齐试玩：队名 `mhn`/`man`、联赛 `tnjc`/`tn`。**[changmen 实拉 2026-09-17]** `structureTournamentMatchesPB` 今日菜单几乎全是联赛 `mids` 袋（中英文皆 0 队名）；队名靠 `structureMatchBaseInfoByMidsPB`，但该接口常漏回 mid 且易 `0401038`；漏网再用 `getMatchBaseInfoByOddsPB`。缺 HTTP 底价或缺让球/大小仍出牌（空盘）；赛程袋 19 位 id 不当事（与 C8 短 `mid` 一致）。

---

## 4. WebSocket

### 4.1 连接

**[官网可证实]** worker：`url.replace("http","ws")` + `/yewuws2/push` + `?requestId=`。

```text
wss://{HTTP 网关 host}/yewuws2/push?requestId={token}
```

| 客户端发出 | 常量名 | 间隔 / 说明 |
|------------|--------|-------------|
| `{ cmd:"C0", requestId }` | `S_CMD_HEART_BEAT` | **15s**（`HEARTBEAT_TIME=15e3`） |
| `{ cmd:"C00" }` | `S_CMD_CLOSE_CONNECT` | 断开前 |
| `{ cmd:"C8", cufm, list:[{mid,hpid,level}] }` | `S_CMD_MATCH_STATUS` | 订阅；见下 |

C8 发送节流（不是赔率周期）：

| `cufm` | 场景 | 节流 |
|--------|------|------|
| `L` | 列表多场 | **1500ms** |
| `LM` | 详情单场 `one_send` | **4000ms** |

足球列表实测 `hpid`：`1,2,4,17,18,19`（全场/半场独赢+让球+大小），`level: 13`。详情单场 `hpid: "*"`。

**[changmen 实现]** `obSportWs.ts`：同样推送 URL、C0 15s、C8 列表订 `1,2,4,17,18,19`，并带官网 worker 同款 `marketLevel` 字段。拒绝 MQTT URL。只订 4–12 位数字 `mid`（赛程袋里的 19 位 id 订了不出 C105）。

HTTP 与 WS **都由足球页直连**。2026-09-08 对照：同一 token、同一 C8，Origin 分别为官网 / localhost / `chrome-extension://` 都能收到 C105；`yewu11` OPTIONS 亦 `Access-Control-Allow-Origin: *`。源站不按 Origin 卡盘口，也不需要扩展代发。

此前误以为 localhost Origin 会被拒，曾用扩展 offscreen / 隐式试玩弹窗转发；那条路已停。

### 4.2 入站命令（worker `I_` + 允许集 `Vl`）

处理队列 **[官网可证实]**：`push_msg` 立刻 `postMessage` 到主线程，**没有**再做时间窗节流。部分命令用 `ctsp` 丢过期包（**不含 C105**）。

C115：`eventTime` 比服务器时间早超过 **20s** 则丢。

| cmd | 官网名 | 内容 | 足球页 |
|-----|--------|------|--------|
| **C105** | `R_CMD_HANDICAP_STATUS` | 价 + 线 `hv` + 锁 `hs/os`；`cd` 常为 base64+zlib | **接**：`sportOddsStore` + 线 |
| **C102** | `R_CMD_MATCH_EVNT` | 事件 `cmec`、节次 `mmp`、已赛秒 `mst` | **接**：时钟/节次 |
| **C103** | `R_CMD_MATCH_SCORE` | `msc[]`，`S0\|主:客` 为当前比分 | **接**：比分 |
| **C101** | `R_CMD_MATCH_STATUS` | 比赛状态 | 部分（`ms`） |
| **C104** | `R_CMD_MATCH_HANDICAP_STATUS` | 整场盘状态 | 未单独展示 |
| **C106** | `R_CMD_BET_LIST_ODDS` | 注单栏赔率 | 不接 |
| **C107** | `R_CMD_MATCH_VIDEO_ANIMA` | 动画/视频 | 不接 |
| **C108** | `R_CMD_FINANCE_DAY_UPD` | 财务日 | 不接 |
| **C109** | （未写入 `I_`） | `{mid,csid,hs,ms}` 场级状态 | **接** `ms` |
| **C110** | `R_CMD_MATCH_PLALY_COUNT` | `{mid, mc}` 玩法个数 | **不接**（最吵） |
| **C112** | `R_CMD_CHANGE_CATEGORY` | 分类变更 | 不接 |
| **C115** | | 事件 + `eventTime` | 不接（详情事件流） |
| **C153** | | `{mid, hids[]}` 常与 C110 同帧 | 不接 |
| **C201** | `R_CMD_ORDER_STATUS` | 注单。`cd.orderNo` + `cd.status`（0/1 受理，2/4 失败） | **接**：写 `football_orders`（不进电竞 orders） |
| **C202** | `R_CMD_ORDER_COUNT` | 注单数量 | 不接 |
| **C301** | `R_CMD_MENU_SECTION` | 菜单块 | 不接 |
| **C302** | `R_CMD_MATCH_START` | 开赛 | **接**：未知 `mid` 时补拉列表（`csid=1`） |
| **C303** | `R_CMD_HANDICAP_PLAY` | `{mid,hpid}` 玩法集合变了 | **接**：2s 节流后重拉该场详情 |
| **C501** | | 试玩页有流量 | 不接 |
| **C801** | `R_CMD_MATCH_FILL_TIME` | 补时 | 未接 |
| **C901** | `R_CMD_LEAGUE_CLOSE` | 联赛关 | 不接 |
| **C3301** | | 侧栏菜单场次数（1011/1012…） | 不接 |

`ctsp` 去重集合：`C101 C102 C103 C104 C107 C110 C112 C120 C302 C303 C901`。

其它 `Vl` 成员（`C113/C114/C120/C151/C152/C203/C209/C210…`）worker 放行，试玩滚球足球主路径未作为盘口源。

### 4.3 试玩滚球足球实测频率（2026-09-08）

条件：侧栏「足球 LIVE」、约 7 场列表 C8 + 1 场详情 `hpid:*`，约 12s。

| cmd | 约频率 | 说明 |
|-----|--------|------|
| C105 | **~12 条/秒**（约 1.5 条/场/秒，成簇） | 有变动才推，不是固定 tick |
| C110 | ~80–90 条/秒 | 玩法个数，套利/展示可忽略 |
| C102 / C103 | 各 ~10 条/秒 | 事件 / 比分统计 |
| C303 | 数条/秒 | 新线/玩法变化 |
| C8（客户端发出） | 列表约 1.5s | 重订可见场，不是刷新赔率 |

---

## 5. C105 载荷

**[官网可证实]** `pb!=="1"` 时 `cd` 先 `atob` 再 **zlib inflate**（pako `inflate`，不是 HTTP PB 的 gzip），然后 `JSON.parse(decodeURIComponent(…))`。再把 `hls[]` 收成 `hls2[hpid][]`。

`hs===2` 的线不进报价（`hpid=10001` 除外）；`os===3` 的投注项丢掉。

盘（`hl`）：

| 字段 | 含义 |
|------|------|
| `hid` | 盘实例 |
| `hpid` / `chpid` | 玩法：1/17 独赢，4/19 让球，2/18 大小 |
| `hv` | 线（`-0.5`、`1.5`；欧式让球可为 `1-0`） |
| `hn` | 同玩法下第几条线 |
| `hs` | 盘状态，`2` 锁 |
| `hps` | 该盘对应比分，如 `S1\|1:0` |
| `mid` | 比赛 |

投注项 `ol[]`：

| 字段 | 含义 |
|------|------|
| `oid` | 订阅键 |
| `ot` | `1` 主 / `X` 平 / `2` 客 |
| `os` | `1` 开，`2` 锁，`3` 丢弃 |
| `ov` | 欧赔 × 100000（`203000` → 2.03） |
| `ov2` | 港水；有则优先于 `ov` |
| `obv` | 展示用水位，常与 `ov` 同形 |

**[changmen 实现]** `unzipObSportPushCd` 解 `cd`；`parseObSportPushOdds` 出 `oid + 欧赔 + line`；锁盘写入 `0` 并 `has()` 覆盖 UI 为 `-`。

---

## 6. 比分 / 时钟 / 事件

**C103 `msc`**：`S0|3:1` 当前比分；另有角球 `S8`、控球 `S104` 等，足球页只用 `S0`。

**C102**：

| 字段 | 含义 |
|------|------|
| `cmec` | 事件码（`goal`、`kick_off`、`yellow_card`、VAR…），表在试玩 `football_all_events_map` |
| `mmp` | 节次。滚球实测 **6=上半、7=下半**；`31` 中场；`90/999` 完场 |
| `mst` / `msts` | 已赛秒 |

**[changmen 实现]** `obSportLiveStore` 按 OB `mid` 存比分/节次/时钟；卡片本地 1s 补走秒。不写电竞 `API_SaveLiveTimer` / `matchStore`。

---

## 7. changmen 足球页对照

```text
tryPlay 或粘贴会话
  → 本机 sport session
HTTP 页面直连 yewu11 → footballStore 列表（结构 + 底价）
WS C8(mids) → C105 → sportOddsStore（禁止 fo）
         → C102/C103 → obSportLiveStore（比分时钟）
         → C303 → 重拉该场详情盘口
UI：HTTP 底 + store 覆盖；30s 快照后再用 store 盖回
WS C201 → football_orders 拒单/盈亏（能解析才写）
体育会话 45s：RDS 列表 + GET `/yewu13/v1/betOrder/queryOrderStatus` + POST `/yewurecord/order/betRecord/getOrderListPB`
用户栏「当日盈亏」读 calendar today，不跟侧栏日期走
```

足球跟单订单 **[changmen 实现]**：独立 `football_orders`，不进电竞 `orders`。展示对齐电竞 `getOrders`：下单后 `waitObSportVenueOrderHydration` 等注单出现再落库；队名取 `detailList[].homeName`/`awayName`，赔率取 `oddFinally`，本地「联赛 mid vs 客」占位不落库。

**[官网可证实]** `post_getOrderList` 请求体（PC `use-id`）：`orderStatus`/`selected` 0=未结、1=已结；`timeType:1`、`orderBy:1`、`page`/`size`、`userId`。回包 `data.records[]` + `detailList[]`：`oddFinally`/`oddsValues`、`betAmount`、`matchInfo`、`playName`、`playOptionName`、`marketValue`、`outcome`（2走水 3输 4赢 5赢半 6输半）。**没有** `settleFlag`。

| 层 | 文件 |
|----|------|
| 试玩 token | `obSportTrial.ts` |
| 会话 | `obSportSessionLocal.ts` |
| HTTP | `obSportFootballFetch.ts` |
| WS | `obSportWs.ts` |
| 比分解码 | `obSportLive.ts` |
| 实时赔率会话 | `sportLiveOdds.ts` |
| 赔率缓存 | `stores/sportOddsStore.ts` |
| 比赛态 | `stores/obSportLiveStore.ts` |
| 注单轮询 | `obSportBetRecord.ts` → `footballOrderStore` |
| 列表板 | `FootballMatchBoard.vue` / `FootballMatchCard.vue` |

故意不接：C110/C153/C107/C3301/C106、消息中心 `yewuws4`、电竞 MQTT。

列表相对试玩的差异只有时间窗口和盘口种类；不要再因「这场没有让球/大小」或「底价 HTTP 失败」把比赛从板上拿掉。

---

## 8. 与电竞 OB 的隔离

| | 电竞 OB | 体育试玩 |
|--|---------|----------|
| 登录 | `djtop-capi` demo | `yewu6/user/tryPlay` |
| 列表 | `/game/index` JSON | `/yewu11/…PB` |
| 实时 | MQTT `/market/oddsUpdate/` | JSON `yewuws2` C105 |
| 写入 | `fo` + SaveMatch | `sportOddsStore` + 足球 store |
| 会话 | `platforms.json` / CollectPlatform | 本机 sport session |

混用电竞 token 拉体育、或把体育推送写入 `fo`，都会串线。

---

## 9. 本机合场

**[changmen 扩展 · 2026-09-08 冻结]** 产品定案见 [ARB_MULTI_SPORT.md §3c](../../../../docs/ARB_MULTI_SPORT.md#3c-足球-ob-本机合场冻结)。

```text
VPS  Client_GetFootballMatchs   →  PM∥PF 已合场 DTO（sport_merge）
本机  fetchObFootballAsClientMatchDtos →  OB DTO（页面直连 yewu11）
浏览器 mergeFootballClientLists  →  overlay；合不上并列
不写 RDS / client_matches / sport_merge / 电竞 matcher
```

| 允许 | 禁止 |
|------|------|
| 本机把 OB 源挂到已有 PM∥PF 场上 | 把 OB 列表上报 matcher / `API_SaveMatch` |
| 共享别名表 + 时间窗 + 朝向（目标算法） | 原文标题相等当作身份 |
| 合不上并列；猜测打标 | 猜测场进 N4 / 写 `fo` |

实现（2026-09-20 起）：`client/web/src/runtime/footballMatchKey.ts`（身份键 + 翻转重定向）+ `mergeFootballClientLists`（overlay）。键 = 联赛码（`unknown_fb` 通配，真实码硬隔离）+ 归一队名对 + 开赛小时桶 + 主客朝向；归一走 `@changmen/shared/catalog/football_team_key`（与 server `sport_team_plugin` 共用 `football_team_aliases.json`；去重音 / 去填充词）。配对分层：canonical 全等 = 确定；token 子集 = 猜测 → DTO 打 `MergeGuess`（禁入 N4）；OB 占位标题（无队名）退回「小时|标题」旧键。

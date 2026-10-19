# 赛事身份模型与不变量

本文定义「同一场比赛」和「同一支队伍」在 changmen 里的判定模型,并列出必须成立的不变量。
它是合场(`server/match/matcher` 的 compose/)、人工关联(`server/match/matcher`)、队伍解析(`server/match/identity` / `server/match/resolver`)三者共同的契约。

改这三个模块前先读本文。发现代码与本文冲突时,**先判断是本文错还是代码错**,不要默默让两者分叉——
本文存在的意义就是给「参考朝向」「两个队名算不算同一支」这类问题一个唯一答案。

---

## 1. 模型

### 实体

| 概念 | 定义 | 落库 |
|------|------|------|
| 真实队伍 | 现实中的一支战队,归属于**一个游戏** | `canonical_teams`,主键 `gb_team_id`,`UNIQUE(game, name)` |
| 平台队伍 | 某博彩平台对某支队伍的本地记录 | `team_venue_maps`,`UNIQUE(venue, venue_team_id)` |
| 真实赛事 | 现实中的一场比赛 = (游戏, 两支队伍, 开赛时间) | 无独立表,由合场推导 |
| 平台赛事 | 某平台对某场比赛的本地记录 | `platform_matches` |
| 合并赛事 | 系统认定为同一场的一组平台赛事 | `client_matches` |

### 身份

**队伍身份**是查表得到的,不是算出来的:

```
(venue, venue_team_id) --team_venue_maps--> gb_team_id
```

**赛事身份**是从队伍身份派生的:

```
赛事标识 = (GameID, {gb_home, gb_away} 无序对, 开赛时间窗)
```

对应 `match/matcher/compose` 的聚类键 `match:id:<GameID>:<gb小>:<gb大>`
(`server/match/matcher/compose/normalize/platform_entry.js` `pairKeyId`)。

**朝向**是从队伍身份派生的:

```
平台行 aligned  ⟺  该行主队解析出的 gb == client_match.home_gb_team_id
平台行 reversed ⟺  该行主队解析出的 gb == client_match.away_gb_team_id
```

### 为什么这样分层

平台之间没有共享标识符,身份解析无法回避。关键在于**把它收敛到队伍这一层**:
队伍数量少、变化慢、映射一次对所有未来赛事永久有效;赛事数量大、每天全新。
解析 N 支队,而不是比较 N² 对赛事。

这也意味着:**赛事匹配本身不应该包含任何模糊判断**。它只做查表和相等比较。
所有模糊性都应被隔离在「给平台队伍补 gb」这一件事里。

---

## 2. 不变量

### I1 身份解析唯一入口

平台队伍 → `gb_team_id` 只能经由 `team_venue_maps` 查表。

「两个队名是否指同一支队」这种模糊判断**只能存在于一个组件里**,且其输出只能用于
*建议建立映射*,不能被当作身份直接消费。

> 违反的代价:每处各自实现一套队名判断,彼此口径不同。子串法会把 `LOS` 判成 `LOS Academy`,
> 别名表法不会;去重音的会把 `Honvéd` 和 `Honved` 判同,不去的不会。同一个问题在系统不同位置
> 得到不同答案,且没有任何地方会报错。

### I2 已知身份与猜测身份必须显式区分

按编号合出的赛事与按队名猜出的赛事,必须携带不同的标记,并且这个标记要传递到下游消费者。

下游(尤其自动下注 / 套利)必须能据此决定敢不敢用。

> `client_matches.pairing_tier` / `pairing_confidence` 就是为此设计的字段。
> 若它们长期为 null,说明这条不变量没有被执行。

### I3 朝向唯一真相

朝向的唯一真相是 `client_matches.home_gb_team_id` / `away_gb_team_id`。

平台行的 aligned / reversed **必须由映射推导**,不得存在第二种独立判断方式
(不得依据平台优先级、不得依据队名相似度、不得依据平台自身的主客字段)。

人工 override(`force_aligned` / `force_reversed`)只允许作为**推导不出结论时**的兜底,
且必须可识别为人工值;一旦两侧 gb 齐备、推导有确定结论,推导结果优先。

> 违反的代价:同一场比赛,合场算法、人工关联页、赔率展示可能各自认为主客不同,
> 导致赔率挂到错误的一侧。这是直接的资金风险。

### I4 一个编号只属于一个游戏

`gb_team_id` 按游戏划分。写入 `team_venue_maps` 时,本次映射的 `game` 必须与
该 `gb_team_id` 在 `canonical_teams` 里的 `game` 一致。

多游戏战队(OG、GamerLegion、FOKUS……)的每个分部各自持有独立编号。

> `canonical_teams` 已有 `UNIQUE(game, name)`,但 `team_venue_maps` 侧没有对应约束,
> 需要由写入路径校验,或补 schema 约束。

### I5 编号的空值语义单一

`gb_team_id` 只有「有值」和「无值(NULL)」两种状态。`0` 不是合法编号。

任何 `Number(x) || null`、`x ? ... : ...` 之类会把 `0` 与缺失混为一谈的写法,
在解析 gb 时都是错的。编号在整个链路上的类型也必须一致(统一按字符串比较或统一按数字,不得混用)。

---

## 3. 降级路径的边界

队伍缺编号时,系统退回按队名合场。这条路径**允许存在**,但必须被围起来:

| 要求 | 说明 |
|------|------|
| 仅在缺编号时触发 | 两侧 gb 齐备的平台行不得再走队名路径 |
| 结果必须打标 | 满足 I2 |
| 不得反向污染模型 | 不得因为「队名路径需要」而在核心表里增加第二套朝向来源(I3)或放宽编号约束(I4) |
| 应当持续收缩 | 覆盖率提升后,这条路径的占比应下降;它是过渡设施,不是长期结构 |

**当前实测**(2026-08-07):归档 4724 场中,两侧都有编号锁的占 72.3%,两侧都无的占 27.7%;
`team_venue_maps` 5848 行中 1478 行(25%)无编号。

---

## 4. 执行核对

首轮核对时间 2026-08-07。行号为当时快照,改动后可能漂移。

**五条不变量当前无一完全成立。**

### 一个反复出现的形状:守卫写好了,没接上

| 符号 | 定义处 | 状态 |
|------|--------|------|
| `CANONICAL_ANCHOR_PLATFORMS` | `match-identity/teams/provider_priority.js:20`(导出于 140) | 无任何消费者 |
| `anchorGbValidForGame` | `match-identity/teams/team_key.js:231`(导出于 243) | 无任何消费者 |
| `pairing_tier` / `pairing_confidence` / `event_anchor` | 生产 RDS `client_matches` 已有列 | 全仓库零引用;归档 4724 行仅 4 行有值,来自仓库外 SQL |

这三样恰好分别对应 I3、I4、I2。**不变量不是没被想到,是想到了没有落地。**

### I1 身份解析唯一入口 — 不成立

队名归一化有 **4 套独立实现**:

| 实现 | 位置 | 差异 |
|------|------|------|
| `normalizeTeam` | `match-identity/teams/team_key.js:69-78` | HTML 实体解码 + `team_aliases.json` 别名表 |
| `_norm` | `match/resolver/team_db.js:31-40` | 上者的副本,已漂移 |
| `normalizeTeamName` | `match/matcher/ui/public/index.html:825-833` | 无解码、无别名表 |
| `normalize` | `match/resolver/normalize.js:11-27` | 另一套后缀表(去 `team`/`club`/`fc`) |

后果举例:`PARIVISION` 与 `TEAM VISION` 在合场侧判为同队(别名表),在 matcher UI 判为不同队。

绕过 `team_venue_maps` 的身份解析旁路:`lookupGbTeamIdByName`(`match-identity/teams/team_key.js:198-221`)按归一化队名查 `canonical_teams` 得 gb,被 `reconcile_by_name.js:40-46` 用于给缺 gb 的条目补 gb。**猜测出来的身份在此被当作确定身份消费**,违反 I1 与 I2。

`canonicalMatchKey`(`match-identity/teams/team_key.js:86`)已无消费者;其内 `_saveMapping` 声明 4 参、调用传 5 参,`gameCode` 静默丢弃(`match-identity/teams/team_key.js:29-33` vs `113-115`)。属死代码,优先级低。

### I2 已知身份与猜测身份必须显式区分 — 未实现

合场内部确实区分:`merge_key` 前缀 `match:id:` / `match:name:`,内存字段 `_clusterBasis`。但这个区分**在出库时被丢弃**:

- `_applyClientMatchRows`(`backend/core/db/store.js:321-337`)不映射 `merge_key`
- `ClientMatchDto`(`packages/api-contract/src/dto.ts:205-218`)无对应字段
- 前端全域零引用

因此自动下注链路(`pickArbLegs` → `prepareArbAttempt` → `betFilters`)看到的「按编号确定的合场」与「按队名猜出的合场」**数据形状完全一致**,无任何门控。

### I3 朝向唯一真相 — 显著偏离

锁本身不是只读推导:`pickLockFromAnchors`(`match/matcher/compose/sides/orientation_lock.js:43-57`)用锚平台的 native 主客**重写** `home_gb/away_gb`。

朝向判定存在多条独立通道:

| 通道 | 位置 | 依据 |
|------|------|------|
| gb 推导(唯一合规) | `sideModeAgainstLock:181-186` | gb 相等比较 |
| 队名兜底 | `sideModeAgainstLock:188-197` | gb 不全时比 canonical 队名 |
| 人工关联判朝向 | `match/matcher/link/index.js:140-172` `analyzeSideAlignment` | 纯队名,不用 gb |
| UI 多数票 | `match/matcher/ui/public/index.html:1763-1768` | DB 锁不在平台映射多数里时,**以多数票压过锁** |

平台优先级至少 4 套且互不一致:`PROVIDER_PRIORITY`(OB 优先)、`LOCK_ANCHOR_PLATFORMS`(Polymarket 优先)、UI `PLATFORM_REF_ORDER`、`META_PLATFORM_ORDER`。

`force_reversed` 无条件压过 gb 推导;`force_aligned` 则不能把推导出的 `reversed` 改回(`project_sources.js:30-41`)。这个不对称**意外地**挡住了一半的误覆盖,但它不是设计意图的表达。

### I4 一个编号只属于一个游戏 — 无任何强制

所有写入路径均不校验游戏一致性:`rdsUpsertTeamPlatformMaps`(`db/rds/team_store.js:345-384`)、`reassignGbTeamId`(`526-563`)、`upsertManualTeamPlatformMap`(`match/matcher/link/index.js:598-617`)。

人工关联可跨游戏:`validateTeamLinkPair`(`link/index.js:792-810`)只检查平台不同与 gameCode 非 unknown,**不比较两侧 game**;UI `canConnectTeamHandles`(`index.html:2245-2258`)对不同场次直接返回 true。

实测后果:6 个编号横跨两个游戏。因合场键含 `GameID`,暂未导致跨游戏合场。

### I5 编号空值语义单一 — 无强制

- `parseLockedGb`(`orientation_lock.js:16-21`)把 `0` 转成字符串 `"0"`,后续 truthy 判断当作有效锁
- `parseGbTeamId`(`link/index.js:32-37`)接受 0
- `_gbTeamIdForDb`(`db/rds/client_matches_store.js:19-26`)把 0 写成 NULL,但入参为 null(保留旧锁)时旧的 0 会被永久保留
- 多处 falsy 判断把 0 与缺失混同:`dedupe_rows.js:68-71`、`merge_clusters.js:145-148`、`resolveTeamLinkGbPlan`(`link/index.js:822-831`)

实测后果:`client_matches_history #1535` 两侧 gb 均为 0。

**附带**:gb 在内存按字符串、在 DB 按数字,多处 `===` 比较存在静默失败风险。

### 修复优先级

| 序 | 目标 | 理由 | 规模 |
|----|------|------|------|
| 1 | I2 打通 | 唯一直接对应资金风险的缺口;猜测合场无门控地进入自动下注 | 中,且不触碰匹配算法 |
| 2 | I4 + I5 补 guard | 守卫函数 `anchorGbValidForGame` 已存在,接上即可;`validateTeamLinkPair` 加 game 比较 | 小 |
| 3 | I3 收敛朝向 | 已产生过可见故障;先去掉 UI 多数票与关联侧队名判朝向,让 gb 推导唯一 | 中 |
| 4 | I1 收敛队名判断 | 是前三者的共同根因,但改动面最大,应在有回归护栏后做 | 大 |

---

## 相关文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) — monorepo 结构与数据流
- [../server/match/matcher/README.md](../server/match/matcher/README.md) — 人工关联工具
- `server/db/maintenance/legacy/diagnostics/audit-team-maps.mjs` — 队伍映射结构巡检(对应 I1/I4/I5)
- [ARB_MULTI_SPORT.md §3c](./ARB_MULTI_SPORT.md#3c-足球-ob-本机合场冻结) — **足球本机 OB overlay**：匹配在浏览器执行，不进本文的电竞 compose / `client_matches`。不放松上文 I1–I5。

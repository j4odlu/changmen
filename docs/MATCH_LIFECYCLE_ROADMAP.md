# 合场演进（匹配 / 结束分离）

- 更新：2026-08-13
- 原则：**一步只动一层；上线后行为对外可视为不变；下一步另开，不提前耦合**
- 触发：`#1669` 未开赛被差量 `markEnded` 误伤 → 明确「匹配」与「结束」是两套动作

## 正确逻辑

- 馆 `SaveMatch` → 只更新该馆（`platform_*`）
- changmen → **匹配**（映射）与 **结束**（可见性）分开决策、分开写入理由
- `GetMatchs` → 只读投影（`ended_at IS NULL`）
- 比赛结束即结束，**没有**自动 ended→active（人工「恢复」除外）

### 两套动作

| 动作 | 职责 | 可写 | 触发 | 失败时 |
|------|------|------|------|--------|
| **匹配 Match** | 哪些馆组成这场 | `matchs` / 朝向 / 盘口 / 新建或复用 id | 定时 compose；以后 Save* 增量 | 本拍少挂馆或跳过更新；**不**标 ended |
| **结束 End** | 这场是否还对用户可见 | 仅 `ended_at`（以后可加 `ended_reason`） | `ended_filter`，或人工 force | 漏判 → 短暂幽灵活跃；**不用**「本拍没合出来」代替 |

```text
SaveMatch(platform_*)
        │
        ▼
   Match 匹配 ──upsert matchs 等──► client_matches
        │                                    │
        │                                    ▼
        └────────► End 结束 ──仅 ended_at──► client_matches
                         ▲
                         │
                  人工强制结束
```

`#1669` 根因：Match 一拍没产出 id → 被当成 End（compose 差量 `markEndedIds` + 写库锁内再猜）。

## 分步（互不影响）

每一步有**唯一改动面**。做完可单独合并/上线；不做下一步也不坏。

| 步 | 只改什么 | 明确不改 | 对外行为 | 做完标志 |
|----|----------|----------|----------|----------|
| **M1** | 结束**写入权威**：compose 补丁语义 + RDS 写库 | 不合场聚类、不改 Save*/GetMatchs、不改 `ended_filter` 规则本身 | 未开赛掉簇不再误藏；真结束仍离开列表；已 ended 不复活 | `#1669` 类不可复现；单测绿 |
| **M2** | 进程内拆 `matchPass` / `endPass`（同一定时器，分日志） | 不改算法公式、不改 API | 行为同 M1 | 日志/指标可分 Match 与 End |
| **M3** | 身份复用：**ended 行不占 merge_key / 重叠复用** | 不改合键公式、不改 ended_filter | 同队下场不再粘到 sticky ended id | Metanoia 类可自动进活场 |
| **M4** | 挂接面：**seed / align / 内存 link / DB match_id** 跳过 ended | 不改合键公式、不改 ended_filter 判定 | 同队下场不再被 seed 吃回 ended | 馆源可重新成簇并回写新 id |
| **2** | 仅 GetMatchs **读/缓存** | 不改写库、不合场、不改 Save* | 列表内容不变，可更快 | miss/尖刺下降 |
| **3** | 仅 **触发时机**：Save* 后入队相关场增量 Match | 不改匹配算法核心、不改 API 形状 | 更及时；定时全量可先保留 | 增量能跟上馆变 |
| **4** | 仅 **状态表达**（`ended_reason`：`filter` / `force`，或 lifecycle） | 不顺便改馆写入、不改前端协议 | 可审计自动 vs 强制 | 状态与代码同构 |

```text
M1 结束写入权威 ──独立──► 可停
M2 进程内拆分   ──建议在 M1 后──► 可停
M3 ended 不占复用 ──建议在 M1 后──► 可停
M4 seed/align/match_id ──建议在 M3 后──► 可停
步2 读取        ──独立──► 可停（勿与 M* 同提交）
步3 触发        ──建议在 M1 后──► 可停
步4 状态模型    ──建议在步3 后──► 终态
```

## 协作规矩

1. 同一时间只做一个步。
2. 该步 PR/提交只碰上表「只改什么」里的文件。
3. 发现别的问题 → 记下来，不塞进当前步。

## 当前

**M1 已完成**（2026-08-13）— 结束写入权威已落地。  
**M2 已完成**（2026-08-13）— 进程内 `runMatchPass` / `runEndPass` 拆分 + 分日志。  
**M3 已完成**（2026-08-15）— ended 行不再参与 merge_key / 平台重叠身份复用。  
**M4 已完成**（2026-08-15）— seed / align / 内存链接 / `platform_matches.match_id` 均不粘 sticky ended。

下一步任选：**步2**（GetMatchs 读/缓存）或 **步3**（Save* 增量触发）；勿与未合并改动搅在同一提交。

---

## M1 执行方案（具体）

### 要改掉的行为

**A. compose**（`server/match/matcher/compose/compose_once.js`）

```js
markEndedIds = previousActiveIds.filter(
  id => !activeIds.has(id) && !endedIds.has(id),
);
```

「本拍 `info` 没有 = 结束」——把 Match 缺口写成 End。

**B. 写库**（`rds/rds/client_matches_store.js` → `_rdsWriteClientMatchesLifecycle`）

事务里：

1. `LOCK TABLE client_matches …`
2. `SELECT id … WHERE ended_at IS NULL`（全活跃 id）
3. 「库里活跃 − 本拍活跃」**再猜**该结束的 id
4. 与传入的 `markEndedIds` 合并后 `UPDATE`

写库层第二次把「没写进本拍活跃集」当成 End。

### 改后行为

**Compose → 写补丁**

| 字段 | 含义 |
|------|------|
| `activeRows` | 本拍 Match 产出的活场 |
| `endedRows` | **仅** `ended_filter` 产出的结束场（全量 UPSERT） |
| `markEndedIds` | **空**（或仅 sticky 再确认，与现 `stickyOnlyIds` 合并） |
| gap | `previousActive − info − endedRows` → 只打 warn（`[match-composer] active gap`），**不**标 ended |

**RDS 写库**

1. 短事务；去掉整表锁 + 全扫活跃 id（同进程 in-flight + write_guard）
2. UPSERT `activeRows`、`endedRows`（同 id 时丢掉 active，保留）
3. `UPDATE … ended_at` **仅** payload `markEndedIds`（且不在本拍 active）
4. sticky SQL 不变（已 ended 不会被活跃 UPSERT 清掉）

**旧调用方**

| 调用方 | M1 要求 |
|--------|---------|
| `compose/io/write.js` → `writeClientMatchesAsync({ activeRows, endedRows, markEndedIds })` | compose 不再传差量 end；写库只信补丁 |
| 旧式 `writeClientMatches(rows[])` | 仍用内存 `_lastWrittenIds` 生成 `markEndedIds`，**不**再靠锁内扫库 |

### 不动的范围

- 合场聚类 / 打分 / `isClientMatchEnded` 判定公式
- SaveMatch / GetMatchs / 前端
- `forceEndClientMatch` / `clearClientMatchEndedAt`
- 空写保护、自动 ended→active（仍禁止）

### 文件清单

- `server/match/matcher/compose/compose_once.js`
- `server/match/matcher/compose/io/write.js`（注释/传参收紧，若需要）
- `rds/rds/client_matches_store.js`
- matcher/db 相关单测
- 本文档（当前=M1 做完标志）

### 提交内顺序

1. 写库：删锁内差集；`markIds` = 仅 payload `markEndedIds`
2. compose：去掉 previousActive 差量 markEnded；gap 只 warn
3. 单测：掉簇不归档；`endedRows` 仍归档；未传入的活跃 id 写库不自创 end；sticky 不复活
4. 跑 matcher compose + store 相关 vitest
5. 更新本文「当前」为 M1 已完成 / 下一步 M2 或步2

### 风险与验收

- **风险**：`ended_filter` 漏判 → 多留 GetMatchs 几拍（幽灵活跃）。优于未开赛 sticky 误藏。
- **验收**
  - 活跃 id 本拍不在 `info`、未进 `endedRows` → 库中仍 `ended_at IS NULL`
  - `endedRows` 含该 id → 写后有 `ended_at`
  - 人工 force 后，活跃 UPSERT 不能清 `ended_at`
  - 生产：开赛前掉簇不再把场打进「已隐藏」；真结束场仍离开 GetMatchs

### M1 停点

合并上线后**停**。不顺手做 M2 / 步2。存量已误标场需要时点「恢复」，不做自动复活。

### M1 落地记录

- `compose_once.js`：`resolveComposeEndPatch` → `markEndedIds=[]`，`activeGaps` 只 warn
- `client_matches_store.js`：删锁内活跃差集；`resolveLifecycleMarkIds` 只信 payload
- 单测：`compose_end_patch.test.mjs`、`client_matches_lifecycle.test.mjs`

---

## M2（进程内 Match / End 拆分）

### 改动

- `pipeline.js`：`runMatchPass`（映射/投影）与 `runEndPass`（仅 `ended_filter`）；`resolveAndProject` 保留为二者编排兼容层
- `compose_once.js`：先 Match 再 End，打 `[match-composer] matchPass …ms · endPass …ms`；写库仍一次 `writeClientMatchesAsync`
- 单测：`tests/match_end_pass.test.mjs`

### 不做

- 新表、GetMatchs、算法公式、两次写库

### M2 停点

可停。下一步另开。

---

## M3（ended 不占身份复用）

### 根因

同队下场共用 `merge_key`（正常）；但 `resolveIds*` / `buildExistingClientIdKeyIndex` / `fetchClientMatchIdIndex` 把 **已 ended** 行也纳入复用 → 新场拿到 sticky ended id → `endPass` 整场滤掉（Metanoia `#1459`）。

### 改动

- `resolveIdsDryRun`：只对活跃行建 merge_key / sig 索引，重叠复用也只用活跃行
- `buildExistingClientIdKeyIndex`：跳过 `ended_at`
- `fetchClientMatchIdIndex` / `findClientMatchIdByMergeKey`：SQL 仅 `ended_at IS NULL`
- `insertClientMatchStub`：23505 时优先活跃；仅 ended 占坑则 `merge_key '@ended:'||id` 腾键再 insert
- identity `findReuseIdBy*`：跳过 ended；`resolveClientMatchIds` / dry-run 忽略指向非活跃 id 的 platform link
- 单测：`ended_lifecycle.test.mjs` + `client_match_ids.test.mjs`（M3）

### 不做

- 不自动清旧 ended、不改合键公式、不改 sticky 语义

### M3 停点

可停。存量卡住场等下一轮 matchMerge 应拿到新 id。

## M4（seed / align / match_id 不粘 ended）

### 根因

M3 只堵了身份**索引**；`seedFromExisting`、align 索引、内存 `ClientMatchId`、DB `platform_matches.match_id` 仍可把新馆源喂回 sticky ended → endPass 整场滤掉。

### 改动

- `seedFromExisting`：跳过 `ended_at`
- `reuseIdSync` / `resolveClientMatchIds`：非活跃正 `row.ID` 丢弃
- `buildClientMatchIndexes`：跳过 ended（与 M3 复用索引一致）
- `composeFromSnapshot`：`stripEndedClientMatchLinks`；bindings 仅活跃 CM
- PB rotnum sticky：不从 ended 行取粘性
- 写库后 `clearPlatformMatchIdsPointingAtEnded()`（JOIN 自愈），再 backfill 活场
- 单测：cluster / align / ended_lifecycle（M4）

### 不做

- 不改合键 / ended_filter / UI 推荐策略

### M4 停点

可停。

## 步2–4（另开）

与上表一致。步4 再考虑 `ended_reason`（`filter` | `force`），便于审计；仍禁止自动复活。

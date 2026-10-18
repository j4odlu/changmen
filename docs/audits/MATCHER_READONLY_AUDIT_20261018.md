# Matcher 与队伍映射只读检查

[changmen 扩展] 取证时间：2026-10-17 23:50 至 2026-10-18 00:00（Asia/Taipei）。本机 `E:\River\arb\changmen`；生产为现有香港 VPS，后端版本 `abdfce46d46f562c208ea0d832b6cafc02fd2360`，Actions 代次 `39015482088`。未修改业务实现、匹配规则、依赖或发布配置；未执行 scraper、合场命令或维护命令，未重启服务、写生产数据、commit/push 或部署。

## 结论

**当前生产 matcher 正在持续合场，不依赖三个 scraper 执行；不能据此认定三个 scraper 无用或可删除。** 当前存在一处可复现的数据读取契约缺陷、三个已损坏的辅助命令，以及一场来源缺失后保留的旧活跃行。本次不是“所有匹配正确、没有漏合/误合”的完整验收。

- 生产主服务 PID `2009911`，内嵌 matcher 默认 30 秒；matcher/composer 心跳同 PID，composer `wrote:true`。独立 105 秒观察窗内进程身份及环境文件元数据不变，正常日志连续产出 9 场；较早快照为 10 场。该窗无新增 matcher 执行错误、映射加载失败、自动收录异常、拒绝空写或 ENOSPC。
- RDS 的一次只读快照有 10 条 active、5,461 条 ended 合场；OB/PB/RAY 分别出现在 10/3/4 条 active 的来源中。后续 active 来源复核未发现同一平台来源同时被多个 active 使用，未发现现存来源的 `match_id` 与其 active 归属冲突。
- 88 个本地非测试 JS/MJS/CJS 文件语法检查，85 个通过，仅三个 scraper 失败；生产对应三个文件也失败。抽核的 6 个启动/主链路文件与已发布 HEAD 一致，本地仅换行差异；本地 matcher 目录没有未提交源码差异。抽核不等于逐文件审计整个生产目录。
- 本地相关回归 39 文件、196 项通过、1 项既有 expected-fail；合场反向依赖门禁、resolver 体育身份冒烟及原 551/551（含 FOK 等价、共用边界、GTC 隔离）通过。测试使用隔离临时存储和离线 DB 目标，没有执行真实合场或下单。

## 实际数据流

```text
日常场馆采集 → platform_matches
    → matcher.loadSnapshot
    → autoRegisterTeams（新增待识别队伍，不自动分配标准编号）
    → team_venue_maps

人工关联 → canonical_teams、team_venue_maps
独立 scraper → 读取既有标准队伍，补写 team_venue_maps
    → resolver/team_db.js 读取映射并构建插件
    → matcher 按平台队伍 ID、队名等规则聚类与合场
    → client_matches → 客户端读取
```

`server/backend/server.js` 启动 `@changmen/matcher/loop.js`；唯一正常合场写链是 `matchMergeOnce → composeOnce`。composer 先自动收录，再检查映射 revision、加载插件，最后合场；没有调用三个 scraper。

自动收录明确覆盖 OB、PB、RAY 等平台，但只增加 `gb_team_id=NULL` 的待识别记录。人工关联负责建立/调整标准队伍与平台 ID 的关系并失效相关插件缓存。不能将“自动收录队伍”说成“已经自动正确完成所有跨馆队伍匹配”。

## 发现 1：映射读取丢失 game，未知游戏回退失效（P2）

位置：`server/db/rds/team_store.js:60` 与 `server/match/resolver/team_db.js:107`。

`fetchAllTeamPlatformMaps()` 的 SELECT 与行组装均未返回 `game`；resolver 却依靠 `row.game` 构建 `gameFromMaps`，用于补全 canonical 中的未知游戏。当前原始字段到消费者的契约不一致。

用真实 DAL 函数和真实 resolver 插件、模拟数据库行复现：canonical.game 为 `unknown`、场馆映射 game 为 `lol` 时，最终插件仍返回 `unknown`；仅在模拟返回契约补回 `game` 的对照组中返回 `lol`。没有改应用文件或访问网络。生产这两个相关 DAL 函数的完整函数体与本地一致。

生产只读聚合找到 **1 条**标准队伍记录满足“canonical 游戏未知、关联场馆映射游戏已知”的条件；查询时没有 active 合场的主客标准 ID 引用未知游戏标准队伍。该缺陷已确认，不能由此推定已经造成当前某场误合/漏合，也不能因当前 active 未引用而当成无影响。

建议后续单独补齐 DAL 字段契约并增加真实返回字段到插件的回归；保持现有身份规则和匹配阈值，不借此重写合场算法。本次只报告，未修复。

## 发现 2：三个辅助 scraper 当前损坏，仍有历史数据痕迹（P2）

| 脚本 | 本地与生产首个语法错误位置 |
| --- | --- |
| `ob_scraper.js` | 138 行，日志字符串引号损坏 |
| `pb_scraper.mjs` | 70 行，日志字符串引号损坏 |
| `ray_scraper.js` | 122 行，日志字符串引号损坏 |

这些文件与已提交 HEAD 在相同位置失败，不是本批消费者导入替换导致。它们不进入正常启动链；取证时没有发现运行中的同名脚本，检查的 root cron、`/etc/crontab`、`/etc/cron.d` 和 systemd 单元也未发现显式登记。此检查不能排除外部调度、间接 shell 包装或过去曾执行。

生产数据现状：

| 场馆 | 已映射 | 待识别 | 仍标记 source=scraper |
| --- | ---: | ---: | ---: |
| OB | 1,218 | 407 | 229 |
| PB | 555 | 106 | 0 |
| RAY | 1,119 | 191 | 44 |

OB/RAY 保留下来的 scraper 标签行在该快照中均未映射标准 ID；现有已识别映射主要标记为 manual。source 可以被后续更新改写，不能把当前标签数量当成完整历史运行次数或历史贡献，也不能仅据标签证明由当前这三个版本生成。全部平台已映射行的标准 ID 孤儿数为 0。

**纠正此前表述**：应说“当前主流程不调用、当前版本的手动命令不可执行”；不应说“实际上没有用”。后续应对照自动收录/人工关联的覆盖，决定恢复补数功能或明确归档，不能直接删除。

## 观察项：8141 只有 PM 来源仍在，命中保留规则

观察窗开始后该 ID 多次记录 `active gap (not ending)`。后续 RDS 复核：原 OB 来源 `6667308080721250` 已不在 `platform_matches`；Polymarket `1203891` 仍在且绑定 `8141`，队伍为 Omega / Bushido Wildcats。

该场只剩一个现存来源，与当前 `MIN_PLATFORMS=2` 的合场门槛不符；PM 来源仍在，亦不满足“全部来源消失并超过时间门”的结束条件。因此“本轮输出 9 场、RDS 仍有 10 条 active”与当前保留策略一致。这是源码规则与快照的解释，不是读取生产内存后逐步重放的结果。

不能因此强制结束该场或清空旧行。尚未完成浏览器现场核对，不能确认旧来源在 UI 中的标记/刷新是否充分；如用户仍看到该场长期停留，需要围绕这一具体样本继续检查，而非改动通用结束或 FOK 门控。

## 其他边界

- resolver 旧 `scoreMatchPair` 的反向队伍判断仍有 1 项已登记 expected-fail。当前 matcher 使用 `team_db` 插件与自己的 compose/朝向链，未发现主链调用该旧评分函数；不能将它描述为当前所有反向赛事都匹配失败。
- 映射 revision 目前只聚合行数、已映射数、标准 ID 总和和最大行 ID，并非映射全文/标准队伍全文版本。正常人工关联会显式失效缓存；外部直接改库不能假定所有改动都会被该 revision 捕获。原有“脚本改库后需刷新相关运行缓存”的边界仍需遵守。
- 截取历史日志包含保护性拒绝空写和 ENOSPC 记录，无逐行时间戳，不能归为当前持续故障。105 秒新增日志中二者均为 0；当前应用文件系统可用约 24.4 GiB、可用 inode 充足。新增 error 日志仅观察到 active-gap 警告；未删除或截断日志。
- 当前主服务和其他 7 个已登记主栈进程未因本批变化；应用根范围只读进程枚举用于核对已知启动关系，不证明其他主机不存在任意写者。
- 没有重跑真实浏览器、长时间行情、生产合场重放、下注或 PostgreSQL 写入场景。因此不授予发布批准，也不宣称匹配准确率/覆盖率达到某个百分比。

## 证据与后续顺序

证据目录 `output/matcher-audit-20261017/`（沿用检查开始日期）：

- `production-first.json`、`source-audit.json`、`production-contracts.json`：生产身份、有限源码与函数体核对、语法扫描。首轮 `/proc/stat` 字段偏移解析不正确，首轮 startTicks 不作证据；进程稳定性仅使用后续按最后一个右括号正确切分的 `state-before.json` / `state-after.json`。
- `production-db*.json`：独立 pg Client，连接默认只读并以 `REPEATABLE READ READ ONLY` 开启事务，查询聚合及限定样本，最终 ROLLBACK；未调用应用 DB 初始化、schema runner、自动收录或任何 DML。
- `state-before.json` / `state-after.json`、`active-gaps.json`、`application-processes.json`：105 秒增量日志、两类心跳、PID/启动 tick/根目录及环境文件元数据，无凭据内容。
- `matcher-tests.log`、`resolver-smoke.log`、`merge-boundary.log`、`fok-vps.log`：离线行为和固定保护。
- `contract-probe.json` / `.mjs`：真实函数配模拟行的隔离复现，不是生产写入试验。

建议顺序：先修复并锁住 `game` 返回字段契约，再对三个 scraper 选择修复或归档；来源缺失的 8141 单独观察。原行情、经典 FOK、固定 551 保护、HTTP 实际预检和本地簿默认关闭保持。

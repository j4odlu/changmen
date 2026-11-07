# 历史审计与验收证据

[changmen 扩展] 文档状态说明：2026-10-22。此目录保存原批次审计、验收、失败记录及 JSON 证据；目录中的“当前”“最新”“通过”“NO-GO”都须结合原报告日期、提交和后续报告解释，不代表今天的运行状态。

本次文档整理保留已有证据文件及路径，不重录固定哈希或旧候选清单。部分尚未实施的设计仍引用这些审计作为问题依据，因此不能将整个目录认定为已失效或删除。

| 用途 | 入口 |
| --- | --- |
| 当前目录与安装布局 | [WORKSPACE_LAYOUT](../WORKSPACE_LAYOUT.md) |
| 当前发布与验收 | [INDEPENDENT_DEPLOYMENT](../INDEPENDENT_DEPLOYMENT.md) · [ACTIONS_VALIDATION_PERFORMANCE](../ACTIONS_VALIDATION_PERFORMANCE_20261019.md) |
| 合场发布一致性审计 | [2026-10-19 审计](./MATCH_PUBLICATION_CONSISTENCY_AUDIT_20261019.md) · [未实施方案](../MATCH_PUBLICATION_CONSISTENCY_PLAN.md) |
| 篮球全场获胜源站标识 | [2026-10-25 RAY 只读快照](./2026-10-25-ray-basketball/research.json) · [第一期接入方案](../RAY_PM_BASKETBALL_PHASE1_PLAN.md) |
| OB 篮球接入方案审计 | [2026-10-29 审计](./OB_BASKETBALL_INTEGRATION_AUDIT_20261029.md) · [接入方案](../OB_BASKETBALL_INTEGRATION_PLAN.md) · [源站样本与离线检查](./2026-10-29-ob-basketball/) |
| PM 本地簿证据及启用限制 | [浏览器持续观察审计](./PM_BOOK_BROWSER_CONTINUITY_AUDIT_20261017.md) · [恢复与取证设计](../PM_BOOK_RECOVERY_AND_EVIDENCE_PLAN_20261017.md) |
| PM 官方直连实时价格方案审计 | [2026-11-07 审计与最小修订方案](./PM_DIRECT_REALTIME_PRICE_PLAN_AUDIT_20261107.md) · [SDK 离线证据](./2026-11-07-pm-direct-price/sdk-smoke-result.json)；3 项 P1、4 项 P2，未实施 |
| PM 本对话已实施改动复核 | [2026-11-07 代码与官方协议复核](./PM_DIRECT_DIALOGUE_CHANGES_REVIEW_20261107.md) · [后续问题修复](./PM_PRICE_REVIEW_FIXES_20261107.md)；既有自建 WS，未复用 SDK 行情管理器；切源遗漏及空盘旧价已修复，完整验证结果见修复报告 |
| PM 官方 SDK 接管评估 | [2026-11-07 评估](../PM_OFFICIAL_SDK_MARKET_EVALUATION_20261107.md) · [两版离线证据](./2026-11-07-pm-sdk-evaluation/results.json)；0.12.0 / 0.17.0 各 14 项通过，保留生命周期适配缺口，未迁移运行代码 |
| 2026-11-07 待提交改动发布检查 | [修复前检查报告](./TODAY_CHANGES_PREDEPLOY_REVIEW_20261107.md) · [后续修复与验证](./PM_PRICE_REVIEW_FIXES_20261107.md)；普通 push 的冻结保护保留，尚未发布 |
| 指定订单复用补单上下沿 | [2026-10-30 源码与设计审计](./ORDER_EXIT_MAKEUP_BAND_AUDIT_20261030.md) · [简化接入方案](../ORDER_EXIT_MAKEUP_BAND_PLAN.md)；未实施 |
| 已退役方案 | [归档清单](../archive/20261022-retired-plans/README.md) |

返回 [文档索引](../README.md)。

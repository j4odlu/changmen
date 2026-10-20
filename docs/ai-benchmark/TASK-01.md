# TASK-01 — 修改 pm-sports 写 client_matches（field-level ownership）

- 任务类型：真实维护任务（调查变体，只读协议）
- Resolver query：`modify pm-sports match writing`（输出存档 `resolver-outputs/TASK-01.json`）
- 预定义 relevant set：collectors/polymarket-sports/**、rds/rds/pm_sport_store.js、rds/rds/client_matches_store.js、rds/rds/matcher_store.js、core/db/store.js、matcher compose 路径、deploy/ecosystem.config.cjs、docs/DATA_STORAGE.md

## Baseline
- Files inspected：31（自报有序列表）
- Relevant：≈28；Irrelevant exploration：≈3
- Architecture mistakes：0（正确识别 field 级写者、COALESCE 保护、write_guard 边界）
- **污染事件**：自行 grep 发现 `.ai/architecture/build-index.mjs` 并引用其 writers/F-02 结论（T1 对照效力部分失效，如实记录）
- Human corrections：0（协议不允许干预）；UNCERTAINTIES：5
- First-pass success：是
- Token/context：UNKNOWN

## Truth-aware
- Files inspected：40（含对 Context 每条证据的回验读取）
- Relevant：≈36；Irrelevant exploration：≈4
- Architecture mistakes：0；显式标注 F-02（humanDecisionRequired）
- 发现 Context 未覆盖的写者（RESOLVER_GAP）：`markClientMatchesEndedByStartBefore`（多运行时 ended 补丁）、`insertClientMatchStub`（compose 内 INSERT）
- Evidence usage：显式（answer 含「Context 证实/证伪」）；First-pass success：是

## Architecture Error Prevention
- 未触发（baseline 未发生 ownership 误判）——RESOLVER_MISS：无

## Context Reduction
- 否。Truth-aware 为回验 Context 反而多读 ≈9 个文件。

## Observations
- 两个会话答案质量相当（都到达 field-level 真相）。Truth 的主要增量是「证实/证伪纪律」与 gap 发现，而非定位提速。

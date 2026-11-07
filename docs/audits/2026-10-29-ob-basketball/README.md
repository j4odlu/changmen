# OB 篮球调研与审计证据

2026-10-29，仅保存公开赛事数据、源码现状和审计输出，不包含试玩或真实账号凭证。

| 文件 | 用途 |
| --- | --- |
| [upstream_samples.json](upstream_samples.json) | 同日官方试玩 HTTP/WS 的选定字段、前端版本、公共源地址和包哈希；独赢 C105 只观察到锁盘 |
| [offline_audit.json](offline_audit.json) | 14 项现有源码检查的输入含义、实际结果和 docs 范围检查计划；不是新实现验收 |
| [source_manifest.json](source_manifest.json) | 基线提交与 56 个实际工作区源码的 SHA256，包含两份原有未跟踪 listener 源码 |
| [reproduce.mjs](reproduce.mjs) | 从仓库根运行的只读复核入口，不发起网络请求、投注请求或 DB 操作，不覆盖证据文件 |

复核命令：

```text
node --import tsx docs/audits/2026-10-29-ob-basketball/reproduce.mjs
```

该命令验证报告所述的原始现状。后续实施集成后，其中部分结果应变化；不应为了让这份历史审计持续输出一致而阻止正确实现。

matcher 的 storage 导入可能初始化现有环境配置并打印 DB 模式；脚本不调用数据库查询或写入函数。复核不需要打印、传递或复制任何环境变量值。

返回 [方案](../../OB_BASKETBALL_INTEGRATION_PLAN.md) 或 [审计报告](../OB_BASKETBALL_INTEGRATION_AUDIT_20261029.md)。

# 2026-10-18 push / 部署前检查

## 范围与证据

本次从远端 `master`（`42b07aab86b054b08a4ec85d617af1cf4b047faa`）到本机
`b565cd2478923a3bc5471508f774c6c83041ecb6` 的五个待推送提交开始检查，
覆盖目录隔离、workspace 安装、版本指纹、补单受理与恢复、FOK 冻结保护、
数据库维护、发布验收、归档和失败回滚。后续修复也纳入最终候选验收。

原始日志、复现、最终候选身份及结果写入本机忽略目录
`output/prepush-audit-20261018/`；完整机器验收使用
`output/change-validation/verdict.json`、`output/fok-release-verdict.json`、
`output/database-compatibility/verdict.json`。必须核对这些结果的 commit/tree/inputFingerprint，
不能把修复前或其它运行的成功结果当作当前候选证据。

## 已复现并修复

1. **RDS 独立安装验收漏复制新增依赖。** storage 已依赖
   `devtools/runtime-tooling`，但 `rds-assets-standalone-postgres.mjs` 仍只复制
   DB/shared/storage。npm 会创建工具包链接，旧三包断言失败；若仅放宽断言，
   仍会留下缺失源码的链接。修复补齐工具包源码，保留精确四包断言，增加源码存在
   检查和原生 storage runtime-version 导入。未引入 backend / 浏览器包。
   临时 PostgreSQL 已验证离线安装、43 份 SQL 初始化、只读默认行为、账本不重放及维护入口。
2. **PM 状态页响应体卡住会使轮询永久停顿。** 原实现收到 HTTP 响应头就清除
   超时，而 `json()` 仍可能不返回，watcher 的 inFlight 因而不能释放。
   修复将超时覆盖到完整 JSON 读取结束；保留原有网络失败、unknown 与防抖语义。
   新增两个真实 loopback HTTP 回归，分别卡住 summary / components 的 body，
   验证中止和后续请求恢复。旧实现复现失败，修复后独立套件 25 项通过。

未更改下注/签名/金额/价格/深度/双腿顺序、补单计数与绑定、SQL 资产、
冻结清单或既有精确还原证明。

## 依赖安全检查：尚未清零

`npm audit --omit=dev --json` 当前报告 38 项包级告警：critical 1、high 15、
moderate 9、low 13。这不是 38 个已证实可利用的业务漏洞；需要按消费者和触发条件排查。
本次未执行 `npm audit fix` 或升级交易 SDK，避免把跨版本行为变化混入目录隔离发布。

已核对的重点：

- `proxy-addr@2.0.7`：
  [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)，
  修复版 2.0.8。触发需要特定错误的 IPv4-mapped IPv6 trust subnet 配置；
  当前 backend 未发现 Express trust proxy 配置，不能仅凭包版本断言已可利用，
  仍需处理升级及生产实际代理配置核查。
- `engine.io@6.6.9`：
  [GHSA-2gc4-cqfq-p2gv](https://github.com/advisories/GHSA-2gc4-cqfq-p2gv)，
  修复版 6.6.10。当前 hub 明确只启用 websocket，符合公告列出的单 transport 缓解方式；
  不应据此把整个 Socket.IO 依赖树视为安全。
- `socket.io-parser@4.2.6`、axios、嵌套 ws、钱包/链 SDK 等仍有告警，
  要分别核对输入信任边界、实际调用和 SDK 兼容性。上述已核对的关键版本在远端基线也存在。

功能验收通过与安全依赖风险清零是两个结论。未完成逐项安全处置前，
不能把本次报告解释为“全部无错误/无漏洞”或无条件发布批准。

## 验收方式与边界

最终候选使用 `npm run check:change -- --publish=full --base=origin/master`，
要求完整 22 阶段及 5 项临时 PostgreSQL 兼容性验收；完成后才可本地封存并核验前后端归档。
临时数据库仅监听 loopback，替换所有数据库 URL 环境变量，不使用生产库或已有集群。
线上源码/版本抓取只读；不进行真实下注、push 或部署。

本机公开 PM 状态页请求曾发生网络超时，因此没有将该次外部网络调用记为通过；
接口形状与超时修复由离线案例和真实本机 HTTP 响应体测试验证。
生产环境、浏览器完整人工走查及部署后健康检查仍须在对应阶段执行。

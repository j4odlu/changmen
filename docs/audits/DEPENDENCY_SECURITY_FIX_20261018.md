# 2026-10-18 依赖安全与提交检查修复

## 修复范围

以 `8db3321d04aca0924998b93fc9fd3efd89ebd8d6` 为修复前候选。
原 `npm audit --omit=dev` 为 38 项包级告警（严重 1、高危 15、中危 9、低危 13）；
修补后为 17 项低危，严重 / 高危 / 中危均为 0。
原始审计和修复日志保留在本机忽略目录 `output/security-fix-20261018/`。

| 依赖 | 修复后版本 | 处理 |
| --- | --- | --- |
| socket.io-parser | 4.2.7 | 零附件包立即拒绝；正常二进制消息和附件上限有回归 |
| proxy-addr | 2.0.8 | 修复 IPv4-mapped IPv6 信任子网误判 |
| engine.io | 6.6.11 | 补齐传输升级协议检查 |
| axios | 1.20.0 / 0.34.0 | 应用和 TronWeb 使用 v1；旧 relay SDK 保留 v0 API 分支 |
| ws | 8.21.0 | 移除 ethers / viem / Engine.IO client 的易受影响嵌套副本 |
| qs / body-parser | 6.16.1 / 1.20.8 | 修补解析与输入限制绕过 |
| Vue 相关包 | 3.5.44 | 统一 runtime/compiler/SSR 补丁版本 |
| form-data / ip-address | 4.0.6 / 10.7.4 | 补齐表单头和地址解析安全修补 |
| nanoid / postcss / source-map-js | 3.3.20 / 8.5.30 / 1.2.2 | 修补生成器和 source-map 问题 |
| esbuild / uuid | 0.28.2 / 11.1.1 | Windows 开发服务补丁；保留现有 CJS UUID v4 消费 API |

没有执行不加区分的 `npm audit fix --force`。npm 在更新嵌套依赖时曾连带升级
TronWeb / ethers；这些无关变动已恢复。所有交易/钱包 SDK 的锁文件记录、workspace
声明和版本均与修复前完全相同，只有受审查的依赖节点发生变化。
`overrides` 用于固定嵌套 Axios、ws、qs、UUID 的已修复版本；其中跨出上游旧范围的
Axios v0 与 UUID 使用实际消费者的本机 HTTP / CJS 回归验证，并继续运行完整交易回归。

## FOK 与历史保护

经典 FOK（默认 legacy）的业务源码、签名、准备时机、价格、金额、深度、双腿顺序、
提交次数、成交确认、补单与订单绑定没有修改。固定的原 551 文件清单以及所有既有
JSON 证明保持原字节不变，没有重新录制或替换基线。

新 `dependency-security-metadata.json` 只登记两份文件的完整哈希和精确补丁：
根 `package.json`、`package-lock.json`。先精确还原本次变动，再进入已有 tooling、
目录隔离和原始完整源码比对链。未登记的版本、额外属性或格式改动不会被还原。
测试额外核对所有变动包都在安全修补白名单，禁止 workspace 与交易 SDK 记录变化。

新增的真实 HTTP 测试不连接平台，使用合成的 FOK JSON 和认证头，验证 HTTP 请求的
JSON 字节、query、头字段、成功响应及错误证据；Socket.IO 测试直接解析恶意/合法数据，
不连接任何实际服务，不进行交易。

## 本机 Git hook

`npm run hooks:install` 只更新当前仓库的本地 `core.hooksPath`，目标为
`scripts/git-hooks`，不改全局设置。相关文件进入 Git，hook 的 LF 和可执行位受到保护。
前端、共享代码、运行时构建工具或根 manifest/lock 的暂存变化触发 `typecheck:frontend`；
删除与改名同样会检查，文件名不拼接到 shell 命令中。
真实临时 Git 仓库回归验证了错误阻止提交、文档提交和从子目录提交的行为。

Windows 原地 `npm ci` 因运行中的 Vite 占用原生文件被拒绝，随后增量安装成功；
干净安装放到临时目录验证。本机实际自定义 Vite 端口为 5576，HTTP 200 已确认，
原服务保持运行，没有停止原有开发栈。

## 尚存低危项与验收边界

17 项低危告警均来自 `elliptic@6.6.1` 及其 SDK 依赖传播。
[GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84)
当前没有修复版本；npm registry 的最新版本仍为 6.6.1。没有为了消除审计计数而
替换 ECDSA 实现、跨代升级/降级 SDK 或掩盖告警。

最终候选须重新执行完整 22 阶段、5 项临时 PostgreSQL 兼容性验收、前端生产构建及
归档绑定检查；机器结果记录具体 commit/tree/inputFingerprint。
本机安装实验使用离线缓存且禁用生命周期脚本，不能替代生产 Linux CI 的原生依赖验证。
本次不 push、不部署、不连接生产数据库写入、不真实下注。

# PM 本地簿架构调整：默认关闭发布复审

[changmen 扩展] 2026-10-17。用户授权先检查原行情与经典 FOK，确认回归检查通过后 commit/push，并由 GitHub Actions 发布；本地订单簿保持默认关闭。本复审只评估关闭状态交付，**不放行生产旁路启用或真实本地预检**。

## 范围与静态审查

工作目录 `E:\River\arb\changmen`，沿用 master，审查基点 `2bdf3773f5270d96a807d5d077bcd42f6724b1ee`。审查时线上前后端发布目录及标记均为该提交，经现有只读 `read-deployed-versions.mjs` 核对；不把固定 FOK 历史基线误认为线上当前版本。

| 共用位置 | 检查结论 |
| --- | --- |
| `realtime/ws.ts`、`marketStream.ts` | 原订阅、报价处理、PING、心跳、自动换线及重连规则保留；只读原帧广播在原报价回调之后。无观察者时不取额外高精度帧时间、不保留原始帧、不建 timer/连接。仍有少量空钩子调用，不能称为字节级零改动或零开销 |
| `installClientCore.ts`、`pmDynamicWsPreflight.ts` | 经典模式仅注册轻量偏好/会话监听；必须已应用 optimized、登录 ready、显式本地开关开启才动态加载 owner。缺省、非法模式及未保存表单不能启动服务；切经典/退出同步释放，迟到 import 无法重启 |
| `pmBookSettings.ts`、设置 UI | 两个 key 缺失均关闭，无自动迁移开启；shadow 不能隐式开启总开关。本次不设置任何用户浏览器 key，保留原有显式实验开关 |
| `fok/preflight.ts` | 新增冻结模拟输入仅在 optimized 下计算；经典价格、金额、深度与 market HTTP 调用保留 |
| `pmBuyPreflight.ts` | 新增字段为类型；经典 HTTP、guard、校时、自动准备 signer 及返回顺序保留，未增加本地簿依赖或等待 |
| `optimized/pmFastPreflight.ts`、`shadowObserver.ts` | 仅动态分支通知旁路；观察者开始/结束异常被隔离，HTTP 原结果/原错误及一次调用保持；本地计算不替换真实结果 |
| 独立服务、Worker、消费者 | 未获得应用授权不创建；不拥有 PM-M 订阅或重连权限；深度租约不能变更源连接。经典分支不加载 owner/Worker，不启动 probe/候选 watcher/循环计时器 |
| 共享包与后端 | 新增独立导出入口，没有把簿导出进原平台入口；没有修改数据库、服务端订单或账号语义。共享包路径使现有发布计划选择 backend-first 联动，实际部署由 Actions 验收后执行 |

源码保护逐条还原精确登记的观察钩子，再与原完整实现比较。未重录 551 项固定基线、放宽 hash、跳过目录或取消负向检查。

## 本轮发现与修复

首轮完整检查暴露测试组合问题，保留原日志 `output/pm-book-disabled-release-check-initial.log`：

1. 两个新增边界测试采用 `node:test`，统一 Vitest 检查将它们识别为无测试。改为 Vitest 的 `test` 导入，全部原断言保留。
2. 历史 tick 边界测试直接读取含新观察钩子的源码，未经过现有精确钩子还原。测试先调用 `restorePmSharedStreamSource`，再验证原 tick 差异及原始全文；不改生产实现或旧基线。
3. 历史迁移负向测试预期读取“被篡改的字符串”，但 WS 新增的严格完整 hash 校验已在读取阶段直接拒绝篡改。针对该文件断言其明确拒绝错误，保持原有篡改不得通过的要求。

修复涉及测试文件，不改经典 FOK 或生产行情实现。五个相关边界文件 **345 项通过**；随后重新执行完整范围检查，不以首轮失败或部分通过作为发布依据。

## 原浏览器证据的适用范围

当前 `realtime/ws.ts`、`orderBook/service.ts`、`orderedWorkerMailbox.ts` 和动态 `shadowWorkerClient.ts` 的文件 SHA-256 均与 [持续浏览器审计](./pm-book-browser-continuity-20261017.json) 记录一致。本轮没有对这些生产文件继续调参或改写。

因此保留此前同输入 ABBA 的 5,865 条原报价完整序列一致证据、原订阅/连接不受旁路开关控制的证据；本轮行为回归另行确认。此前开启旁路测得的 CPU 增长不冒充经典关闭状态的性能结果，也不据此宣称整页生产零开销。

同一浏览器审计的 **1 条未解释差异、真实缺快照推进缺口及生产旁路 NO-GO** 全部保留。本次关闭状态代码发布不表示上述问题已经修复。恢复/取证的后续内容仍仅为 [设计稿](../PM_BOOK_RECOVERY_AND_EVIDENCE_PLAN_20261017.md)。

## 验收记录

已取得以下结果，均保留原门槛和业务断言：

- FOK 等价检查通过：180 项比较、20 项确认故障、45 项原门控；551/551 固定原模块保护通过，没有替换基线。
- 验收控制 5 文件/51 项通过；保护及负向检查 60 文件/1,891 项通过；独立 Node 保护 9 项通过。
- 后端路由编译、团队/adapter/client-core 边界、API 契约、catalog 检查与后端 12 个 workspace 检查通过；前端 `vue-tsc -b` 通过。后端原有 skipped/expected-fail 保留，没有改成通过。
- 初次完整前端检查为 508 文件通过、2 文件各一项失败、3 文件跳过；两项错误均为 `Test timed out in 5000ms`，不是断言不一致。分别涉及钱包 retained readiness 和 credentials 旧/新入口的首次模块加载。该轮 `sourceStable=true`，失败报告保留，不改写为通过。
- 上述两组单独串行运行 93 项全部通过；随后完整前端串行复验 **510 文件/4,518 项通过，原有 3 项跳过**。复验保留原 5s 限制、所有用例，不修改钱包/经典 FOK 生产代码，不为测试放宽业务限制。
- `npm run app:build` 成功，包含生产构建类型检查。最终源码输入指纹仍为 `59d53c5cb0b36732f0fb945e0b97c551bc76668ea586a4b684590052bf6b0db8`，与此前已通过的保护、后端和类型检查一致；4 个浏览器审计关键源码 hash 也再次一致。

验证日志为 `output/pm-book-disabled-release-check.log`、`output/pm-book-disabled-release-isolated.log`、`output/pm-book-disabled-release-frontend-serial.log`、`output/pm-book-disabled-release-build.log`。统一检查的原失败报告 `output/change-validation/verdict.json` 保留，未改写为通过；补充机器记录见 [本地复审汇总](./pm-book-disabled-release-review-20261017.json)，逐项核对原通过项、串行复验、构建、日志 hash 和相同源码指纹。

**本地结论：所需检查在同一份源码上完成，未发现原行情或经典 FOK 行为回归，可提交默认关闭的发布候选。** 精确提交的 CI 验收及部署由 `Validate and release` 另行封存，不用本地工作区检查冒充已发布证据。

## 发布边界

只允许本地簿默认关闭交付，实际预检仍 HTTP，经典 FOK 保持默认 legacy。生产旁路、主动补快照、重订阅、真实本地预检继续不启用。提交包含现有独立簿实现、相关验证和文档；不包含 `output/`、密钥、账号存储或生产环境文件。

推送 master 后由 `.github/workflows/release.yml` 读取实际线上版本、验收候选并按 backend-first 发布。部署完成须核对同一提交的 Actions 结果、前后端发布标记及已加载运行身份；不在本机直接执行生产部署脚本，不以 push 成功代替部署成功。

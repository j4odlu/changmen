# PM 入口清单与依赖边界：批次 A 本机验证

[changmen 扩展] 2026-10-17，工作目录 `E:\River\arb\changmen`，基线 `abdfce46d46f562c208ea0d832b6cafc02fd2360`。本轮仅实施 [解耦方案](../PM_MODULE_DECOUPLING_AND_RELEASE_PLAN_20261017.md) 的批次 A；全部改动留在工作区，未 commit、push 或部署。

## 实施范围

- 新增 `scripts/deploy/component-inputs.json`：22 个入口覆盖原 PM-M/quote Hub、经典 FOK/预检、公共行情流、本地簿与 Worker、web 装配、双端 registry/contract、Node loader。另登记 Node registry 源码及 manifest 等动态输入，保留 package/lock/Vite/瘦包/发布控制输入的保守属性。
- 新增只读检查器 `scripts/verification/component-entry-boundary.mjs`，接入原 `npm run check:boundaries`。使用 TypeScript AST 检查源码导入、转导出、类型依赖、字面量动态导入、require 及其已识别别名、模块 URL、workspace exports 与已知 `@/` 别名。共享文件可递归追踪，遇到循环终止，违规输出具体依赖链。
- Node 源码不得到达已登记浏览器入口及簿目录；浏览器源码不得到达 server/已登记 Node 入口。`registry/adapters.ts` 的浏览器属性单独登记，补上原目录规则放行整个 registry 的缺口。动态加载的 Node `registry/paths.js` 与 `feeds.js` 也作为显式检查输入。
- 单独 Node 单测读取浏览器源码仍允许，并记录为 test 消费者；如果生产源码导入测试文件，继续沿它的依赖检查。运维脚本没有整目录豁免。
- 已登记公开入口必须仍精确解析到清单目标。新增 workspace exports 别名也会参与实际源码解析；重定向已登记入口、跨端 barrel、条件/通配 exports 引出错误环境均有负向用例。

没有修改生产源码、目录布局、workspace/package/lock、实际发布分类、工作流、运行版本来源指纹或原有551保护实现。旧部署选择器未读取新清单；本轮新增工具文件仍按旧规则选择发布范围。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 新入口边界测试 | 49 项通过，含临时仓库正反例及真实 `check:boundaries` CLI 内存注入拒绝测试 |
| 新入口 + 原数据库边界 + 设置/原行情流/执行观察保护 | 5 文件、98 项通过，原保护负向要求保留 |
| 既有发布分类/change-plan/deploy-plan | 原生 `node --test`，29 项通过 |
| 设置、簿宿主、动态预检、shadow Worker 生命周期 | web 下 4 文件、23 项通过，覆盖默认关闭、legacy/default/非法模式、退出/授权/凭据变化等既有用例 |
| `npm run check:boundaries` | 通过，保留原规则及历史数据库精确例外检查 |
| `node scripts/verification/verify-fok-execution-parity.mjs` | 通过：180 组对比、20 个确认故障场景、45 个原门控场景 |
| `npm run check:fok-vps` | 通过：`immutableManifestEntries=551`、`exactProtectedFiles=551`，原等价/共享边界/GTC 隔离子检查均通过 |
| Git 差异检查 | `git diff --check` 通过；改动仅在工具、清单、测试和文档 |

首轮新测试有一个临时仓库相对路径多写一级，已修正测试输入；随后补充负向样例，最终49项通过。发布分类三个旧测试首次误用 Vitest，报 `No test suite found`；未修改这些测试，使用其原生 `node:test` 重新运行29项通过。首次错误与修正方式保留在本记录，未通过重跑隐藏业务失败。

本轮没有前端生产代码改动，因此未重新构建、未跑完整前端/后端大套件，也未进行真实浏览器长时间行情或生产旁路实验。上述结果证明本批工具边界与既有保护通过，不替代此前未完成的快照恢复、差异取证和生产灰度验收。

## 当前证据与限制

完整消费者/依赖链/unknown 报告可通过下列只读命令重新生成；本机副本存于已忽略的 `output/component-entry-audit-20261017/report.json`：

```sh
node scripts/verification/component-entry-boundary.mjs --json
```

本机最终统计见 JSON 报告：扫描2,595个源文件，Node 源码闭包758个，浏览器源码闭包1,031个，Node 静态依赖边1,885条；已登记浏览器入口未发现静态 Node 消费路径。Node 根目录按源码保守取集，包含运维脚本，并不声称每个源文件都由某个已启动进程实际加载。

当前有173条不确定记录，粒度为加载调用或语法诊断位置，包含环境/JSON驱动的 loader、计算路径、未知别名、未解析资源及历史脚本解析问题。比如 `account_cli.js`、`check-collect-platforms.js`、部分 resolver scraper 和 OB 运维脚本存在无法完整解析的位置。检查器保留恢复出的静态依赖并列出诊断，没有修复或跳过这些业务/运维文件，也没有将其宣称为完整依赖证明。

以上为批次 A 首轮快照。后续仅对 PM 进行[动态依赖收口](PM_DYNAMIC_DEPENDENCY_AUDIT_20261017.md)，消除 Worker 扩展名误报后全仓原始unknown为172；PM另有独立目标清单和安装证据，其他历史脚本保持原状。

静态跨端违规和清单不一致会使检查失败；unknown 作为待核查证据报告，不阻塞仍保持原范围的既有全量流程。报告明确固定 `publishScopeOptimizationEnabled=false`、`safeToNarrowPublishScope=false`。外部依赖安装、构建副作用、动态配置实际目标及各组件线上旧树仍未认证；后续需要这些证据后才能启用缩小发布范围。

## 结论

**批次 A 可保留并进入代码评审，实际发布范围继续沿用原规则。** 本轮没有改变原行情、经典 FOK 或 HTTP 实际预检；551项原固定保护全部保留并通过，本地订单簿与旁路继续默认关闭。当前结果不放行生产旁路灰度，也不放行 frontend-only 范围优化。未提交、未推送、未部署。

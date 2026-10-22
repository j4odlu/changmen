# 客户端基础包目录隔离第一轮验收

> [changmen 扩展] **文档状态（2026-10-22）：历史迁移与验收记录。文中的旧目录、兼容入口、workspace 数量、未提交及未部署状态仅对应各自批次；当前布局见 [WORKSPACE_LAYOUT](./WORKSPACE_LAYOUT.md)，安装与发布见 [INDEPENDENT_DEPLOYMENT](./INDEPENDENT_DEPLOYMENT.md)**

[changmen 扩展] 2026-10-19，在 `E:\River\arb\changmen` 的 `master` 工作目录实施，起点为 `ce39897bd33ec11a438332323e9419a379517a93`。本轮完成客户端基础包真实目录迁移；未提交、推送或部署，未访问生产数据库或执行迁移。

## 实施范围

| 包 | 唯一实现位置 | 旧路径用途 |
|---|---|---|
| `@changmen/client-core` | `client/packages/client-core` | 源码转导出、维护命令分派及旧包配置 |
| `@changmen/arb-core` | `client/packages/arb-core` | 源码转导出及旧包配置 |

36 个运行源码文件按原内容迁入新目录：client-core 25 个、arb-core 11 个。旧源码入口只转导出新实现。client-core 的 6 个测试随实现迁移，3 个维护脚本调整目录定位，旧命令仅分派。旧目录退出根 workspace，不保留第二份业务实现；旧 package.json、tsconfig 和入口尚未退役。

包名、公开 exports、外部依赖及业务源码内容保持。更新 workspace、file 依赖、锁文件链接、Vite alias、类型路径、测试发现及源码归属清单，使实际消费者解析到新目录。未启用精简生产安装或缩小发布范围。

## 验证结果

| 验证 | 结果 |
|---|---|
| `npm run check:boundaries` | 通过；39 个迁移入口及新实现检查通过，归属扫描无未分类文件 |
| `npm run check:client-core` | 导出、内部导入及实际消费者检查通过 |
| `npm run check:venue-adapter` | 通过，未使用冻结豁免 |
| `npm run app:build` | 类型检查及生产构建通过；仍有构建产物体积提示 |
| web 全量单测（2 workers） | 522 个文件通过、3 个跳过；4,806 项通过、4 项跳过、0 项失败 |
| 迁移及相关边界定向测试 | 首次 183 项通过；随后迁移与两组元数据测试 102 项通过，两批存在重复覆盖，不累计计数 |
| 独立安装与构建 | 临时测试目录仅含 8 个前端及工具 workspace，不含 server 和旧两个包目录；离线 `npm ci --ignore-scripts` 与 web 生产构建通过，锁文件未变化 |
| `git diff --check` | 通过 |

迁移测试还覆盖旧入口、新入口及公开包入口的函数身份一致性，防止状态桥出现两份实例；验证入口丢失、实现改动及非预期重定向能被发现。独立安装使用仓库外临时测试目录以避免依赖向主目录回退，不是新的开发工作区。

## 旧检查脚本的适配与验证范围

36 个迁移源码文件同时被仓库既存的历史完整源码清单引用。“受保护”指检查脚本会比较内容，不是文件权限锁。本轮仅让这些检查沿精确转发入口读取迁移后的实现，原清单和冻结基线未重写，也未增加目录级豁免。迁移记录包含 36 个源码入口和 3 个维护命令入口。

当前 AGENTS.md 明确要求按改动选择检查，不默认执行无关历史专项。本轮曾额外运行完整 FOK 检查及整个 verification 目录，这是扩大了验证范围，不作为以后目录迁移的默认要求。

额外检查未全部通过：迁移前 HEAD 与迁移后使用同一完整源码检查器比较，均在未修改的 `client/web/src/shared/orderLink.ts` 报告历史源码差异；36 个迁移项通过，没有新增完整源码校验失败。整个 verification 目录执行还遇到既有订单展示校验差异，以及将 node:test 文件交给 Vitest 执行的问题。本轮引入的两处元数据测试定位问题已修复并定向复验通过。不能把这些额外检查写成“全部通过”，也不将无关历史失败归为本轮新问题或目录迁移阻塞。

本轮结论：在所列验证范围内，目录迁移、公开入口及构建安装行为验收通过。该结论不等于生产部署验收，也不承诺仓库全局不存在错误。未改动原有订单展示实现来消除历史校验差异。

### 首次 Actions 发布失败后的更正

提交 `8e35eaa4` 的发布运行 `39237432451` 中，前端与后端检查均通过，controls 的 verification-control 失败，部署步骤全部跳过。此前“不作为目录迁移阻塞”的判断不能用于发布：`validation-plan.mjs` 会在检查脚本变更时选中整个 verification 回归，历史源码校验确实构成了该候选的 CI 阻塞。

根因是已提交的 `4a553bbb` 补单赔率上下沿展示未被历史源码检查识别，涉及 `orderLink.ts` 与 `OrderList.vue`，造成 14 项关联测试失败。修复仅在检查器中登记该提交的精确展示增量：还原后继续核对完整旧源码，不更新原固定基线、不跳过失败测试、不豁免目录，也不改运行源码。新增变异测试确保展示片段、关联规则和操作保护的非预期变化仍被拒绝。一个原本预期“保留差异供后续比较”的 node:test 断言改为验证更早发生的完整源码拒绝。

原本失败的六组测试加新增回归共 194 项通过；独立 node:test 的 9 项通过。按 Actions 相同命令复验完整 verification-control，101 个文件、2,675 项全部通过；边界检查通过。后续部署结果以修复提交对应的 Actions 发布记录为准。

## 本机证据与后续边界

### 同日再次复核

复核发现并修复两处目录迁移遗漏：

- `server/backend/core/esport-api/esport_isolation_audit.smoke.test.mjs` 仍将旧转导出文件作为实际源码读取，导致断言失败。改读新目录，原断言全部保留，运行通过。
- 两个旧包的 `tsconfig.json` 未允许转导出中的 `.ts` 后缀，独立类型检查出现 TS5097。仅在旧配置中启用 `allowImportingTsExtensions`；新旧四套包配置均通过类型检查，并增加实际调用 TypeScript 编译器的回归测试。

本次复核未改动运行源码；此前前端构建、全量单测和独立安装构建结果继续适用。新增复核日志使用 `review-` 前缀。

修复后，迁移、安装声明和源码归属三组定向回归共 130 项通过；边界检查、adapter 检查、旧路径三条维护命令及差异格式检查通过。未重复执行无关专项。

证据位于 `output/client-package-isolation-20261019/`（本机输出，不纳入源码）：`before.json`、`boundaries-final.log`、`build.log`、`frontend.log`、`targeted.log`、`metadata-final.log`、`adapter.log`、`standalone-verdict.json`、`standalone-install.log`、`standalone-build.log`、`fixed-protection-comparison.json` 及额外检查原始日志。

后续应按实际消费者继续拆解混合职责；退役旧入口需先查清引用与工具约束。独立安装实验通过不代表已改变 Actions 的安装或发布策略。本轮保留既有发布策略，未执行数据库操作。开始前已存在的架构文档、matcher README 和其他计划/审计文档改动未纳入本轮修改。

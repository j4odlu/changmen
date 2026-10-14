# 运行版本与分层验收

[changmen 扩展] 2026-10-14。只补可观测性和验收入口，不调整 FOK/GTC 交易、财务规则或数据库结构。

## 查看实际运行版本

- 本地：`http://localhost:5576/runtime-version.html`。
- VPS：页面站的 `/runtime-version.html`。
- 前端元数据：`/runtime-version.json`；后端元数据：`/api/runtime-version`。
- 命令：`npm run version:check -- http://localhost:5576`。需要站点证书/认证的部署可直接在已登录的浏览器查看诊断页。

后端在模块启动时记录 commit、源码指纹、未提交源码状态、启动时间和契约指纹。诊断请求另外读取磁盘源码，二者指纹不同提示重启。Git 更新不会改变旧进程的启动身份；启动身份无法识别时明确返回 unknown/null，不阻止服务启动。VPS 无 `.git` 的不可变发布包从实际 release 目录取得 commit，不读取另一个可变 checkout 的 HEAD。

前端独立记录 Vite 启动/构建身份；开发态另列当前源码，构建产物保留构建身份。前后端可独立发布，commit 不同本身不证明不兼容；契约指纹只是契约输入是否相同，不替代交易验收。指纹是选定代码输入的摘要，不能证明某个依赖已经执行。前端图片按原始字节摘要，文本统一换行；凭证、数据文件、文档、测试与编译生成的 router.js 不计入运行源码摘要。

同一套编译生成的 `account_client_routes.js`、`action_registry.js`、`admin_routes.js`、`pm_pf_routes.js` 由对应 TS 源码代表；matcher 的 `.composer-heartbeat.json` / `.matcher-heartbeat.json` 是运行数据。Git checkout 与无 Git 发布包使用一致的输入范围，避免启动生成文件造成“需重启”误报。

数据库只读观察 public 表的列、约束和索引，返回结构摘要，不返回表数据、结构明细、地址或凭证。单次查询超时 1.5 秒；并发请求合并，结果缓存 60 秒，没有定时轮询。现有数据库没有统一迁移版本记录，返回 `migrationVersion:null / migrationTracking:untracked`；不把源码迁移清单冒充已执行的数据库版本。

## 验收入口

```text
npm run check:change:plan                 # 仅预览；不会声称已验收
npm run check:change -- --staged          # 验收干净候选的实际暂存范围
npm run check:change -- --base=<commit>   # 指定比较起点，仍纳入未提交变化
npm run check:fok-release -- --release-plan=backend-first  # 原完整 22 阶段入口保留
```

默认检查全部未提交/未跟踪变化；干净工作区检查最近一次提交。staged 模式拒绝存在未纳入候选的源码，避免测试另一份工作区实现；应在干净候选 checkout 使用。删除、重命名的原路径也纳入分类，范围为空或未知时采用完整验收。没有强制 fast/tier 或 skip-FOK 参数。

| 层级 | 范围 | 强制验收 |
| --- | --- | --- |
| docs | 仅文档 | 原 551 条保护、验收控制测试 |
| frontend | 非交易核心的前端改动 | 上述保护、边界、前端类型检查/测试/构建 |
| backend | 非交易核心的后端改动 | 上述保护、边界、router 编译/后端测试 |
| integration | 同时涉及两端的独立功能 | 两端检查，原 551 条保护 |
| full | 交易、财务、数据库、共享包/契约、授权、代理、部署、验收规则或未知路径 | 控制测试先行，再执行原完整 22 阶段 |

原 551 条清单与不可变快照未修改，所有层级都必须经过真实保护入口。范围分类按路径保守判断，不猜测金融影响；FOK/GTC 监控调度与撤单属于交易核心，走 full。小范围通过只代表该范围验收，报告的 `completeRelease` 为 false，不能冒充完整发布批准。执行前后核对源码/测试输入；中途变化会拒绝通过。本次改动包括验收规则、公共入口和构建配置，因此采用 full。

## 统一 CI 与发布（2026-10-14）

[changmen 扩展] 自动入口为 Actions **Validate and release**（`release.yml`），master 每次 push 都进入范围判断。共享验收执行一次，再把绑定 commit、Git tree、源码/测试输入指纹、实际检查清单及压缩包 SHA-256 的证据交给组件发布。前后端使用同一 run 的不可变 artifact，发布任务直接消费已经验收的压缩包。原 `deploy-backend.yml` / `deploy-frontend.yml` 为内部复用任务；手动发布在统一入口选择 frontend / backend / full。

CI 先只读核对 VPS 前端发布目录、构建版本及后端进程身份，再分别比较两端实际已发布 commit。推送差异与尚未发布的组件差异共同决定验收范围，前一次失败、取消或只成功一端时，后续文档 push 也会纳入待发布代码。无法确定比较基线时走完整验收。共享 `server/storage/runtime_version.*` 同时影响前端构建与后端；前端单独发布允许后端任务跳过，两端发布必须后端成功后才启用前端。

整个 CI 发布序列排队执行，避免完整验收捕获线上版本期间被另一批发布改变；保留组件锁、失败回退和旧静态 chunks。发布顺序标记使用全局 run ID，避免切换工作流后独立 run number 变小造成误拒绝。组件启用后核对实际 commit、启动身份、源码及契约指纹；后端须已加载当前源码。验证失败会走现有回退，验证报告与验收证据保存于 VPS `.deploy-state/`。

本地手动发布也使用 `sh/deploy-frontend.sh` / `sh/deploy-backend.sh`：完整验收 → 封装绑定证据 → 上传同一压缩包 → 运行身份核对。手动发布缺少可靠的自动线上差异范围，保留完整验收；需要干净的已提交源码和正确的生产 API 构建地址。底层 `publish.sh` 在使用 SSH 前拒绝缺失、失败、旧提交或输入漂移的验收证据。

CI 源码、测试、构建阶段没有平台签单凭证。只读版本捕获使用现有部署 SSH 凭证的临时文件，完成后清理；证据 artifact 只包含验收元数据、必要源码发布包/前端包及运行核验器，不上传本地 `.env` 或运行数据。

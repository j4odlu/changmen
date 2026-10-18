# PM loader 按定义来源绑定的持续验证门禁

[changmen 扩展] 2026-10-17，工作目录 `E:\River\arb\changmen`，提交基线 `abdfce46d46f562c208ea0d832b6cafc02fd2360`。承接[参数调用只读追踪](PM_LOADER_PARAMETER_CALL_AUDIT_20261017.md)。本批把有限来源追踪接入验证门禁，只修改验证工具、清单、测试和文档；不改生产loader、业务代码、安装依赖或实际发布规则，前批未提交内容保留。未 commit/push、未部署。

结束前发现其他操作并行修改了 `server/realtime-hub/README.md`、`pm_maintenance.js`、`pm_maintenance.test.mjs`（本机mtime17:43:40）。本批没有编辑或回退这3个文件；它们不在本批PM loader有界闭包内，本报告不是这些并行业务改动的专项验收。

## 已实施

- `scripts/verification/pm-loader-bindings.mjs`：只读解析源码，在有限模块图上绑定词法符号、显式导入/导出、不可变别名及namespace成员，再将调用归于真实定义文件和函数。不会import被检查模块、启动Worker/WS、连接DB或emit应用代码。
- `scripts/verification/pm-loader-binding-inputs.json`：登记8个真实函数来源、backend facade的4个来源契约、9组已审调用及次数、2个probes helper的选路解释契约。不得删除必要来源或重定向facade来清空检查。调用匹配不依赖局部别名或行号。
- `pm-dependency-audit.mjs` 及已有 `npm run check:boundaries`：自动执行新门禁、汇总来源绑定违规；将真实来源确认的调用再次检查Node访问PM浏览器入口，覆盖旧的按调用拼写检查可能看不到的namespace形式。原边界、动态目标、安装声明、共享20条记录检查继续执行。
- 原PM依赖支持输入清单增加新门禁policy的hash。没有接入发布选择器、修改workflow、远端激活、组件范围或完整来源指纹。

## 真实来源与范围

| 定义文件 | 跟踪函数 | 当前已审调用 |
| --- | --- | ---: |
| packages/venue-adapter/loader/adapter_paths.mjs | reqS、backendRequire、adapterRequire、requirePlatform | 6 |
| devtools/platform-probes/backend/_paths.js | reqS、backendRequire | 3 |
| devtools/platform-probes/backend/_paths.cjs | reqS、backendRequire | 0 |

中央6处为5个既有requirePlatform场馆请求及1次registry/feeds.js请求；probes的3处为RAY/socketcluster-client、TF/ws、IA/socket.io-client。同名函数按定义来源分别计数，不能互相替代。中央reqS/backendRequire以及adapterRequire通用分支的“当前未实例化”证据继续成立。

范围从既有878文件PM闭包出发，由当前仓库的已审loader规则与manifest计算20个顶层预加载文件及5个固定场馆目标的去重21个运行入口，再跟踪其实际源码依赖：最终902个文件，Node232、浏览器680，共享文件可重叠。未将整个probes目录作为种子，当前没有 `*/scripts/*` 文件进入该闭包。门禁从当前源码/元数据重建库存，**不读取前批output证据或依赖生产SSH**。

原报告仍保留20条共享记录和12/3/5分类。新门禁的有限预加载展开报告另有31条原始记录，其增量11条仍是3个字面量调用及两个probes helper的8条内部参数加载记录，含义见前批报告。没有通过删unknown或目录豁免来归零。

## 接受与拒绝边界

| 形式 | 门禁行为 |
| --- | --- |
| 具名import别名、const函数/namespace别名、对象解构 | 保持真实来源；调用仍须匹配登记的来源、调用文件、字面量参数及次数 |
| 具名转导出、本地别名转导出、export-star、namespace转导出、default | 沿显式导出链绑定；循环barrel须收敛，多个条件目标无法唯一绑定则失败 |
| `ns.fn(...)`、`ns["fn"](...)`、显式await后的literal import namespace | 解析具体成员；不因拼写改变丢失已审函数身份 |
| CommonJS require、require别名、module.require、Node createRequire、显式CJS对象/函数转导出、TS import-equals | 解析已知模块边并绑定到实际函数；词法遮蔽的同名普通函数/对象不会被当成已审来源 |
| 变量/展开参数、计算namespace键、缺失成员、未解析模块获取、条件来源 | 标unknown并使检查失败，不能据此缩小范围 |
| mutable别名、回调/容器/return逃逸、namespace spread/rest/default、修改/删除绑定、call/apply/bind或Promise.then间接使用 | 当前不做任意JS执行推断，保守失败并要求显式核对 |
| 新增、删除、重复、改向调用；facade改为同名其他定义；必要来源从policy删除 | 来源/调用契约失败 |
| 预加载展开中原清单之外的未解释加载/未解析依赖 | 失败；不会因为它在devtools而豁免 |
| 配置外部root/search hook或缺少可核验默认库存 | 失败，明确默认库存不覆盖此环境；不跟随外部路径或输出变量值 |

门禁采用有限、显式的数据流，而非完整JS解释器。只在已匹配选路源码契约的精确文件/PG加载函数内认可既有内部计算加载；新增/变更这些规则会使对应解释失效。probes两处新增token契约只是约束解释与源码一致，**不替代或调整原551项精确全文保护**，没有整目录豁免。

新门禁与原检查并列：某些入口写法变化也可能触发原动态登记核对，新增门禁不会自动豁免旧规则。未知回退是“显式报告并非零退出”，不自动生成full发布、不修改实际发布选择。

## 验证

专项内存样例覆盖别名、词法遮蔽、ESM/CJS转导出、循环/namespace/default、嵌套解构、literal acquisition，以及计算参数、反射/逃逸、修改、来源偏移、条件分支和policy缺失等负向场景。

真实 `check:boundaries` 子进程还用内存覆盖源码，验证：

- namespace调用带未知参数被新门禁拒绝；namespace请求PM浏览器入口仍被隔离规则拒绝。
- 实际预加载文件新增opaque import被拒绝；policy删除必要来源被拒绝。
- 既有probes请求改为namespace形式、来源/参数/次数不变时通过。

以上均不改磁盘生产文件。实现过程中的初轮测试暴露CJS合成符号及named-export处理缺口，已修正并保留针对用例；最终验收以代码固定后的一次完整相关集合为准，不把早期失败报告覆盖成通过。

| 检查 | 本批最终结果 |
| --- | --- |
| 来源绑定专项及入口、PM依赖、共享loader、安装解析、原设置/行情流/执行观察边界 | 代码固定后8文件201项全部通过；其中来源绑定73项、PM依赖与真实边界命令29项，完整相关集合约158秒 |
| `npm run check:boundaries` | 通过；8个定义来源、9处来源绑定调用、902个有界文件；原53处动态目标及20条共享记录保留 |
| `npm run check:fok-vps` | 原551项全部通过；FOK等价、共享边界、GTC隔离子检查全部通过，原manifest/hash不改，`fullReleaseAccepted:false` |

本批无前端业务修改，不重复应用安装、构建或浏览器长测。完整本机来源报告可由 `node scripts/verification/pm-dependency-audit.mjs --json` 重建，其中 `loaderBindings` 含来源、调用、库存、hash及违规；本次证据保存在忽略目录 `output/pm-loader-binding-gate-20261017/`。

## 完成条件与剩余限制

**按真实来源绑定、常见显式别名/转导出/namespace及未知失败回退，已成为既有边界命令中的持续门禁。** 这完成了前批人工取证到持续验证的这一项，不等于PM独立发布已具备完整证据。

仍缺候选与线上每组件旧树的双向输入比较、安装/第三方内部闭包和构建影响证明、组件计划与workflow/远端激活一致性，以及不同版本组合下的独立发布/回滚演练。没有认证任意反射、外部瘦包或运行heap/cache；默认库存与未来外部配置不可混用。

`safeToNarrowPublishScope:false`、`publishScopeOptimizationEnabled:false`、`runtimeRootsCertified:false` 保持。原行情、经典FOK、实际HTTP预检和本地簿默认关闭状态不变；未 commit、push、部署或重启。

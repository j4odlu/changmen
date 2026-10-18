# PM 可达通用 loader：五条参数记录只读追踪

[changmen 扩展] 2026-10-17，在 `E:\River\arb\changmen` 只读分析，提交基线仍为 `abdfce46d46f562c208ea0d832b6cafc02fd2360`。承接[20条共享记录](PM_SHARED_LOADER_EVIDENCE_AUDIT_20261017.md)与[生产根目录核对](PM_PRODUCTION_LOADER_READONLY_AUDIT_20261017.md)。本批只补文档和忽略目录中的取证脚本/结果，不修改 loader、应用、检查器、清单、依赖或实际发布规则，不 commit/push。

后续[来源绑定持续门禁](PM_LOADER_BINDING_GATE_AUDIT_20261017.md)已将这项人工证据接入 `check:boundaries`：覆盖8个真实定义、9处已审调用、别名/转导出/namespace与未知失败回退，8文件201项验证通过。下面保留本次只读阶段的范围与历史限制；持续门禁不授权调整实际发布规则。

## 结论

**原5条均可进一步解释为“当前未实例化的开放参数记录”，不是5处正在传入未知目标的调用。** 原 `reqS`、中央 `backendRequire` 没有调用；`adapterRequire` 有1次固定registry调用，但通用路径分支没有调用。在本次有限源码及当前预加载输入范围内，未发现这些入口的参数不明调用或未解释的函数值传递。

不能把结论扩大成“全仓从不使用 backendRequire”：当前预加载文件确有3次调用，来自 **另一个定义** `devtools/platform-probes/backend/_paths.js`，目标都是字面量包名，生产解析与lock一致。原5条所在的中央定义是 `packages/venue-adapter/loader/adapter_paths.mjs`，两者不是转导出关系。

**这些开放入口不再是纯浏览器修改必须联动后端发布的事实依据；新独立发布规则仍不能启用。** 当前“未调用”的证据有明确范围，不能保证未来调用、外部覆盖或反射行为；发布控制、候选/旧树及安装/构建证明仍未完成。

## 五条逐项结果

| 原ID | 中央loader内部记录 | 当前使用证据 | 真正保留的未知 |
| --- | --- | --- | --- |
| shared-12 | reqS外层require(resolve(entry)) | 无调用；只定义并由backend facade具名转导出 | 未来调用者提供的shared后缀，不存在当前参数可供绑定 |
| shared-13 | reqS内层resolve(entry) | 与12是同一API的两层记录，不是另一处调用 | 同12 |
| shared-14 | backendRequire外层require(resolve(specifier)) | 中央定义无调用；facade只转导出，没有消费该绑定 | 未来模块specifier；不能把probes同名函数的3次调用算到这里 |
| shared-15 | backendRequire内层resolve(specifier) | 与14是同一API的两层记录 | 同14 |
| shared-18 | adapterRequire通用require(path.join(root, ...segments)) | 唯一调用是 `adapterRequire("registry", "feeds.js")`，先命中registry缓存分支，不到通用require | 未来非registry参数、动态参数或新增间接调用 |

原20条记录、12/3/5粗分类、`closed:false`及 `safeToNarrowPublishScope:false` 均保留。本批没有改清单把unknown计数写成0；细化结论记为 `uninstantiated-open-port` / `uninstantiated-generic-branch`，不是对任意参数的闭包认证。

## 追踪范围与方法

先按既有PM入口重建878个源码文件闭包，Node208、浏览器680，共享文件可重叠。然后仅以生产已核对的20个顶层预加载JS和5个固定场馆请求的去重文件为额外运行入口：共21个文件，递归其静态依赖后增加24个文件，合计902个，Node232、浏览器仍680。

增加的24个文件是这21个运行文件，加 `backend/_paths.js`、`backend/_paths.cjs` 和 `ray/shared/match_stage.js`。没有把整个probes目录作为种子，没有读取任何 `*/scripts/*`，没有展开历史CLI或测试脚本。HG/session是已识别固定请求；其路径helper属于实际依赖，不是额外历史脚本治理。

只读分析先枚举所有指向中央loader、backend facade及两个probes helper的模块边，再用TypeScript符号绑定将具名import/re-export追溯到函数定义，并检查这些绑定的引用上下文。检查了实际导入形式和CJS导出对象，避免只按函数名grep或把转导出当作调用。此操作不运行应用，也不执行完整类型检查或emit。

结果为7条helper模块边、20处符号引用、4处调用；所有4处调用的参数都是字面量，未解释的函数值使用为0。当前这些helper的消费者没有namespace/default导入、export-star转发、局部函数别名、回调传递、对象存放或函数.call/apply/bind使用。CJS helper只通过 `module.exports` 暴露API，其实际消费者HG/session仅解构 `ESPORT_DATA_DIR`，没有取得reqS/backendRequire。

主要中央调用链为：

```text
PM integration/pm_client_handlers.js → esport-api/store.js
  → backend/core/shared/adapter_paths.js（具名转导出）
  → venue-adapter/loader/adapter_paths.mjs
  → adapterRequire("registry", "feeds.js")（固定缓存分支）
```

`balance_provider.js` 也是facade消费者，但只导入 `requirePlatform`；已核对的5个固定场馆请求没有取得这三个通用绑定。浏览器侧未发现这些helper消费路径。

## 预加载中的同名函数：有调用，但不是未知目标

| 调用位置 | 实际定义来源 | 固定请求 | 生产解析版本 / 版本内入口 |
| --- | --- | --- | --- |
| probes/ray/ws.js:3 | probes/backend/_paths.js | socketcluster-client | 20.0.1；node_modules/socketcluster-client/index.js |
| probes/tf/ws.js:8 | 同上 | ws | 8.21.0；node_modules/ws/index.js |
| probes/ia/ws.js:7 | 同上 | socket.io-client | 4.8.3；node_modules/socket.io-client/build/cjs/index.js |

这里的probes前缀指 `devtools/platform-probes/`。该ESM helper的reqS也无调用；其backendRequire的参数在这3个顶层调用处已确定。CJS helper的reqS/backendRequire均无调用。

这3处由当前预加载规则带入，不能因文件在devtools下就视作“仅测试”。但加载WS库不等于创建WS连接；本次只读解析没有执行这些模块、类构造或连接方法。

生产补核时间为 **2026-10-17 17:26:36（Asia/Taipei）**，仍为版本 `backend-abdfce46d46f562c208ea0d832b6cafc02fd2360-39015482088-1`。31个有界运行文件/元数据与该提交的精确Git blob SHA-256全部一致；包括这24个新增文件、helper包元数据、中央loader/facade及调用文件。8个进程在本次读取前后PID、启动ticks和cwd一致，当前版本链接未变，启动环境与实际dotenv未发现相关根目录/模块搜索覆盖键。

为核对上述3个包，仅启动一个导入Node内置fs/path/crypto/module的只读进程，按helper同样的 `[backend/node_modules, root/node_modules]` 调用 `require.resolve`，记录realpath、入口和package元数据hash、精确lock位置与版本；没有require/import这些第三方包或生产helper。三个入口均在当前版本内，安装版本与lock逐项一致。这不是第三方包内部依赖、安装脚本或未来升级效果的完整证明。

## 原始计数为何不同

原PM报告仍为20条。这个只读取证的预加载展开副本为31条：额外11条是3个固定字面量调用记录，以及两个probes helper中各自reqS/backendRequire的8条内外加载记录。它们不是新增生产代码，也不是11个新未知目标。ESM backendRequire的2条内部记录由3个字面量调用实例化；其余helper开放分支当前未用。

没有改既有入口清单或检查器来接受这些额外记录，生产预加载清单只作为本次只读分析的内存输入。原检查器不具备这里完整的按定义来源绑定及间接使用证明，不能把人工分析自动冒充成持续发布门禁。

## 对独立发布的影响

| 情形 | 本批判断 / 仍需条件 |
| --- | --- |
| 仅浏览器本地簿源码，入口、共享协议、loader及依赖输入不变 | 这5条未使用分支及3个固定Node包请求不应单独强制后端联动；仍须完成组件级候选/线上旧树证明及发布控制 |
| 新增reqS/中央backendRequire/adapterRequire通用调用 | 当前“未使用”证据立即失效；需绑定参数、目标与消费者，证明根目录和两端影响 |
| namespace、计算属性、回调/对象逃逸、反射或计算加载 | 本次未发现这些helper的此类使用；任意JS反射与第三方包内部动态行为未认证。未来出现不能按当前无调用结论降级 |
| 改probes helper、3个固定包的版本/安装布局或根目录 | 已是真实Node预加载输入，需要Node解析及相关兼容验证；不能因为中央同名入口未用而忽略 |
| 启用新的自动独立发布判定 | 尚缺按真实定义绑定、未知/逃逸失败回退的持续证据，以及候选和线上各组件旧树闭包的双向比较；本次只读脚本不是授权器 |
| 发布与构建流程 | 安装/构建影响、组件计划与workflow/远端激活一致性、不同版本组合及独立发布/回滚演练仍未完成；完整来源指纹、制品绑定和551固定保护继续保留 |

**本批完成的是当前5条参数记录的使用取证；没有发现需要修改loader或经典FOK的理由。仍不能据此开启新PM包独立发布规则或生产旁路灰度。** 当前未使用的公共API可以继续保留，不需要为减少审计数字删除兼容入口。

## 验证与证据

本机证据在忽略目录 `output/pm-loader-parameter-audit-20261017/`：原/展开图、`trace.mjs`与符号引用报告、`collect_remote.py`与生产元数据报告、`verdict.json`（含文件hash和断言）。辅助脚本未安装到生产，未改正式检查器，未输出凭据或dotenv内容。

- `npm run check:boundaries`：通过；原53处动态加载和20条共享记录保持，实际发布范围未改。
- `npm run check:fok-vps`：本批通过，原551项逐项完整核对；FOK等价、共享边界和GTC隔离子检查全部通过。manifest和固定hash未改，无源码豁免，结果仍为 `fullReleaseAccepted:false`。
- 源码取证：中央计数0/0/1固定/0通用，4处调用参数全为字面量；生产31/31文件匹配，3个包解析与lock一致，进程稳定。未执行应用、安装、构建或浏览器长测。

原行情、经典FOK、实际HTTP预检和本地簿默认关闭状态不变；不改实际发布规则。未 commit、push、部署或重启。

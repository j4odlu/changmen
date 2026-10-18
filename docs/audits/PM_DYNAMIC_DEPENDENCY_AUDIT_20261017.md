# PM 动态加载与未知依赖收口

[changmen 扩展] 2026-10-17，工作目录 `E:\River\arb\changmen`，提交基线 `abdfce46d46f562c208ea0d832b6cafc02fd2360`。在[批次 A](PM_COMPONENT_ENTRY_BOUNDARY_AUDIT_20261017.md)基础上，仅收口 PM 入口与其实际源码依赖；未修改应用源码、package/lock、默认开关、实际发布分类、工作流或551保护，未 commit/push、未部署。

本记录为依赖声明整理前的快照。后续[adapter依赖声明与干净安装验证](PM_ADAPTER_DEPENDENCY_INSTALL_AUDIT_20261017.md)已补齐3个运行依赖、明确Vue宿主/optional peer，并完成前后30项解析对比；本记录列出的宿主/传递声明问题已在该批次处理，共享loader与发布控制限制仍保留。

这20条共享记录后续已在[共享loader/DB证据批次](PM_SHARED_LOADER_EVIDENCE_AUDIT_20261017.md)逐项分为12条固定目标、3条环境相关、5条参数未知；原始unknown与未认证标记保留，新增路径和选择规则变化会失败。下文保留本批历史证据，实际发布规则仍未调整。

## 结论

**PM 直接动态目标已可逐项检查，但尚不具备启用新的独立发布规则的完整证据。** 动态 `import()` 本身并不是后端耦合。当前阻碍集中在共享安装关系、可覆盖根目录的 Node loader、瘦包/构建输入，以及现有发布分类和来源核验。

本轮不将其他历史脚本纳入整治，也不把全仓未知项归零当作 PM 模块独立发布的前提。PM 专项没有把 `server/backend/scripts` 或 `devtools` 下的历史脚本作为扫描种子；将来若 PM 源码实际导入它们，仍会追踪并报告，不能用目录名豁免。

## 已实施的收口

1. `scripts/deploy/component-inputs.json` 新增 PM 范围：PM adapter、四个簿装配文件、会话/钱包与 PM GTC 宿主，以及后端 PM integration、PM WS hub 和三个 collector 的运行入口。依赖追踪保留共享宿主实际带入的源码，不截断真实依赖来减少数字。
2. `component-entry-boundary.mjs` 增加 `--scope pm`。修复扩展名解析：`./marketData.worker` 虽然 basename 带点，仍可解析到 `.ts`；类型引用和 Worker URL 现在指向同一文件。只修改验证器，未改 Worker 或其启动逻辑。
3. 新增 `pm-dependency-inputs.json`，登记53个动态加载位置、43组文件/种类/目标及其出现次数。包括显式 SDK 懒加载、相对模块、别名和 Worker URL；新增、删除、重复、改向或计算式动态目标均要求重新核对。共享会话宿主中的四个 PredictFun 懒加载也保留在该宿主的清单里，没有扩展到其历史脚本治理。
4. 新增只读 `pm-dependency-audit.mjs`，核对所属 workspace、最近的已安装包、副本版本、精确 lock 位置和子路径文件。不会执行交易模块、loader、签名器或启动任何网络/Worker。安装证据与真实浏览器 exports 选择分别标记，不能用 Node `require.resolve` 冒充 Vite 产物证明。
5. PM 专项接入原 `check:boundaries`，保留原规则和数据库精确例外检查。PM 新的计算式加载、未登记目标、无法解释的直接输入或安装/lock/子路径不一致会使检查失败。共用 Node 代码通过 `requirePlatform`、`adapterRequire`、`backendRequire` 及其已识别别名，显式请求 PM 浏览器入口也会拒绝；这不执行 loader 或认证其环境覆盖后的实际内容。通用全仓 unknown 报告继续保留，不新增历史脚本豁免。

可重现的只读命令：

```sh
node scripts/verification/pm-dependency-audit.mjs --json
node scripts/verification/component-entry-boundary.mjs --scope pm --json
npm run check:boundaries
```

完整本机证据在已忽略的 `output/pm-dependency-audit-20261017/report.json`，包括源文件、加载调用、依赖链、安装副本与构建/配置输入的 SHA-256。统计为878个源文件，Node闭包208个、浏览器闭包680个；共享源文件可同时属于两个闭包。没有展开第三方包内部安装闭包或认证线上旧树。

## 未知项如何归类

专项原始 unknown 共22条：PM 直接输入2条，均为 `auth/l2Auth.ts` 的 `@noble/hashes/hmac`、`@noble/hashes/sha256`；其余20条来自可达的共享运行源码。Worker 原误报已修复。**PM 直接输入当前没有未解释项，不等于安装风险或全部共享不确定性已消失。**

| 类别 | 已取得的证据 | 剩余限制及对独立发布的影响 |
| --- | --- | --- |
| 53处显式动态加载 | 每个目标、位置、次数均可核对；内部模块/Worker可解析，外部包有对应安装/lock/子路径证据 | 本身不要求同时发布后端；动态写法不证明 chunk 真正独立，静态导入可能把同一模块带入主包 |
| 2条 hash 输入 | adapter 最近副本为 `packages/venue-adapter/node_modules/@noble/hashes` **1.3.2**，lock 同位置同版本，HMAC/SHA256 子路径存在 | adapter 未直接声明；不能拿仓库根的1.4.0副本代替实际解析证据。根依赖、hoisting、瘦包或干净安装变化仍需验证 |
| 16条共用平台 loader 记录 | 6个调用的参数已列出：PB/HG/OB/RAY 的 Node 模块请求，以及 `adapterRequire("registry", "feeds.js")`；另10条为 loader 契约/内部计算加载 | 可识别目标类别，尚未证明环境覆盖、外部瘦包与动态扫描的所有实际目标；不能认证修改 loader/registry/根覆盖配置后仍只影响前端 |
| 4条数据库模块查找记录 | 两个 DB 文件各有 `require(require.resolve("pg", { paths: searchPaths }))` 的内外调用 | 属于 PM 后端可达的共享依赖；本轮不改 DB 查找逻辑。修改 PG 安装/搜索路径时需要后端证据，与纯浏览器簿算法修改分别判断 |

16条 loader 记录保留 `closed=false`。`CHANGMEN_ADAPTER_ROOT` / `GAMEBET_ADAPTER_ROOT` 及 probes/Node 根覆盖、registry manifest 与预加载扫描仍是显式不确定输入。这里只检查本机源码，不声称知道线上环境变量或外部瘦包内容。

这20条共享记录不应永久否决所有浏览器源码独立发布。判断要看候选改动是否触及它们、旧/新消费者是否变化；当前仍未实现这种双树判定，因此实际发布继续沿用原规则。

## 已知安装关系

PM 直接导入中有20组“所属 workspace + specifier + 环境”的外部依赖事实。以下包在 adapter 中未直接声明，当前依靠宿主或传递安装关系可解析；没有在本轮修改依赖声明或重新安装：

| 输入 | 最近已安装/锁定版本 | 当前归属问题 |
| --- | --- | --- |
| `@noble/hashes/hmac`、`sha256` | 1.3.2，adapter 局部副本 | 交易鉴权直接引用传递依赖 |
| `vue` | 3.5.38 | PM store直接引用，web宿主声明，adapter未声明其 peer/runtime 关系 |
| `@polymarket/builder-signing-sdk` | 0.0.8 | adapter钱包代码直接引用，依靠宿主安装；后端也消费同名 SDK |
| `@polymarket/builder-relayer-client` | 0.0.10 | adapter钱包代码直接引用，依靠web宿主安装 |

另外，`@polymarket/clob-client-v2` 1.2.0、`viem` 2.53.1、`@polymarket/client` 0.12.0 及 builder-signing-sdk 在本专项的前后端直接源码中都出现。**共享 SDK 要约束依赖升级，不意味着每次修改浏览器调用代码都要发布后端。**

后续依赖整理应单独声明 adapter 的直接运行依赖、明确 Vue 的宿主/peer 关系，并对干净安装与两端实际解析结果做一次受控比较；不在这次工具收口中重装 SDK 或调整 FOK 的签名路径。

## 哪些改动会阻碍独立发布

| 候选改动 | 技术依赖判断 | 当前实际发布规则 |
| --- | --- | --- |
| 仅 PM 本地簿/Worker/浏览器预检消费者源码，依赖与协议输入不变 | 当前无已识别静态 Node 消费路径，有进一步证明前端独占的基础；仍需旧树、构建与契约证据 | 位于 `packages/*` 仍 full，本轮不放宽 |
| 仅 web PM 装配/设置源码 | 浏览器职责；仍保留默认关闭、经典隔离和相关回归 | 继续已有 frontend 规则 |
| PM 后端 integration、collector、WS hub 源码 | Node 职责，按 HTTP/WS 兼容性评估客户端组合 | 继续已有 backend 规则，不因浏览器使用其 API 自动双端发布 |
| 根 package/lock、SDK版本、hoisting/安装关系 | 可能改变两端实际解析；四个包的宿主/传递依赖关系仍待显式化 | 保守 full；不能按包名降级 |
| registry/manifest、Node loader、根目录覆盖 | 双端元数据、动态 Node 选择及外部内容可能变化 | 继续 full；需补充真实目标/消费者证据 |
| Vite alias、`browserNodeBuiltins.ts`、HMAC polyfill | 浏览器 SDK 会经过 Buffer/process 兼容和 HMAC替换；Node仍用原 SDK，需分别核对 | web文件仍 frontend；不把浏览器构建插件当作后端运行消费者 |
| 瘦包同步实现或 `includeBrowserSources` | 默认复制基础设施，显式参数可复制浏览器源码；复制输入与运行消费者分别判断 | adapter内脚本仍 full；本轮不运行同步、不修改产物 |
| 发布分类、来源指纹、远端激活与旧版本比较 | 现有分类仍把 packages 一律双端；两端完整来源指纹覆盖 packages。缺少逐组件新/旧输入证明 | 是启用 PM 包独立发布的直接控制层阻碍；不能删除指纹路径或跳过551来消除 |

标准 monorepo 部署与可选瘦包是不同输入场景，本轮不把本机 monorepo 的解析结果用于认证外部瘦包。完整来源指纹继续保留，后续可另增组件输入证据，不能替换原保护。

## 验证与边界

| 检查 | 结果 |
| --- | --- |
| 入口/PM依赖专项及原数据库、设置、原行情流、执行观察保护 | 6文件、121项通过；其中入口51项、PM专项21项 |
| 原发布分类/change-plan/deploy-plan | `node --test` 29项通过，实际分类实现未改 |
| 默认关闭及生命周期 | web下4文件、23项通过 |
| `npm run check:boundaries` | 通过；全仓原始unknown从173降为172，仅消除Worker扩展名误报，历史项未豁免 |
| FOK等价检查 | 180组对比、20个确认故障场景、45个原门控场景通过 |
| `npm run check:fok-vps` | 原551项逐项通过，manifest与固定基线未改，等价/共享边界/GTC隔离子检查通过 |

没有构建应用、重装依赖、运行真实行情长测或开启生产旁路。本轮只读源码与包元数据；原 PM-M、经典 FOK、实际 HTTP 预检、价格/金额/深度/双腿与成交确认规则没有改动，本地簿与旁路保持默认关闭。

**可以继续评审 PM 浏览器模块的独立输入证据；当前不能据本报告启用新的独立发布规则或生产旁路灰度。** 未 commit、push 或部署。

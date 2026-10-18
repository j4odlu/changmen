# PM adapter 依赖声明与干净安装验证

[changmen 扩展] 2026-10-17，在 `E:\River\arb\changmen` 实施，提交基线仍为 `abdfce46d46f562c208ea0d832b6cafc02fd2360`。本轮承接[动态依赖审计](PM_DYNAMIC_DEPENDENCY_AUDIT_20261017.md)，只收口 adapter 的 PM 直接依赖与 Vue 宿主关系。未 commit/push、未部署。

后续[共享loader/DB逐条证据](PM_SHARED_LOADER_EVIDENCE_AUDIT_20261017.md)将保留的20条记录分为12条固定目标、3条环境相关、5条参数未知，并补充默认路径库存和变更拒绝检查。本记录中的干净安装对比保持原样，未在后续批次重复安装或修改生产loader/DB。

## 实施结果

`packages/venue-adapter/package.json` 新增以下声明，版本均取自整理前 adapter 实际解析的安装副本：

| 依赖 | 声明 | 整理前 → 整理后 |
| --- | --- | --- |
| `@noble/hashes` | dependencies，精确1.3.2 | 1.3.2 → 1.3.2，保留 adapter 局部副本 |
| `@polymarket/builder-signing-sdk` | dependencies，精确0.0.8 | 0.0.8 → 0.0.8 |
| `@polymarket/builder-relayer-client` | dependencies，精确0.0.10 | 0.0.10 → 0.0.10 |
| `vue` | optional peer，`^3.5.13` | 3.5.38 → 3.5.38，由 web 宿主提供 |

既有 client 0.12.0、clob-client-v2 1.2.0、viem 等声明保持原值。没有升级签名库、改变 HMAC 算法、修改订单客户端或调整经典 FOK 的准备/执行路径。

Vue 不作为 adapter 的私有运行依赖；web 保留 `dependencies.vue = "^3.5.13"`。optional peer 对应本包的混合入口：Node 宿主只使用 registry/loader 时不需要 Vue；浏览器宿主使用 PM store 等能力时必须显式提供兼容 Vue。**本轮完整 workspace 安装包含 web，因此实际安装了 Vue；没有据此认证不带 web 的独立瘦包。**

`package-lock.json` 用仓库指定的 npm 11.16.0 更新。逐条比较全部 lock package 记录，唯一变化为 `packages/venue-adapter` 自身新增的 dependencies/peerDependencies/peerDependenciesMeta；其余记录逐项相同，未新增、删除、移动或升级依赖包。

## 两次干净安装

在主工作目录的已忽略 `output/pm-dependency-install-20261017/` 内建立 `before/` 和 `after/` 安装夹具。它们不是 Git worktree，没有切换分支；没有复制 `.env`，没有删除或重装日常目录的 `node_modules`。

- before：原 package/lock 与全部 workspace 清单。
- after：仅更改 adapter 声明及对应 lock 记录；其余 workspace 清单相同。
- 两者均从无 `node_modules` 的目录执行 `npm ci --include=dev --no-audit --no-fund`，Node 24.20.0 / npm 11.16.0；均成功安装846个包，各约21秒。
- 为检查真实 Vite 配置及运行相关离线测试，两份夹具随后复制相同的3,228个源码/测试/配置文件；原 package/lock 保持各自版本。未启动后端、行情连接或真实下单。
- 安装日志保留现有 npm 的 uuid 弃用、global-ignore-file 和四个依赖 install-script 允许策略提示；未自动改动允许列表。实际 Vite解析、类型检查与测试均可执行。

未重新构建应用产物。本次证明限于当前 Windows 安装环境及下列解析/行为集合，不替代 Linux 生产构建或外部瘦包验收。

## 前后端解析对比

新增 `scripts/verification/pm-install-resolution.mjs`，输入为前轮 PM 审计中的20组外部导入事实，另加 SDK 内部 HMAC 的前端/后端用例，共22个输入。它检查：

- 14项 Vite client 解析：加载夹具中的真实 `vite.config.ts`、alias 与浏览器 HMAC 插件；无 HTTP监听、HMR、源码 watcher 或预打包。
- 8项 Node ESM + 8项 Node CJS 解析：从后端/SDK 的实际 importer 目录解析，不把浏览器 `exports` 选择混同于 Node。
- 每项记录安装内的规范目标、最近包名/版本与目标文件 SHA-256；解析越出夹具或缺失会失败。比较器拒绝目标/版本/hash漂移、条目丢失/重复，以及不完整环境证据。

**before/after 的30项记录逐项相同，差异为0。** web 和 adapter 的 Vue 都解析到同一个 Vue 3.5.38 文件，没有新增私有 Vue。

HMAC 环境差异也保持原状：

| 环境 | 实际目标 | 前后结果 |
| --- | --- | --- |
| Node ESM/CJS | `node_modules/@polymarket/builder-signing-sdk/dist/signing/hmac.js` | SDK原文件，目标及hash不变 |
| Vite client | `client/web/src/polyfills/builderSigningHmac.ts` | 既有浏览器替换，目标及hash不变 |

可重现单份解析检查（先准备对应安装及源码夹具）：

```sh
node scripts/verification/pm-install-resolution.mjs --root output/pm-dependency-install-20261017/before --inputs output/pm-dependency-install-20261017/resolution-inputs.json --output output/pm-dependency-install-20261017/before-resolution.json
node scripts/verification/pm-install-resolution.mjs --root output/pm-dependency-install-20261017/after --inputs output/pm-dependency-install-20261017/resolution-inputs.json --output output/pm-dependency-install-20261017/after-resolution.json
```

完整证据留在上述 output 目录：两次安装日志、前后解析JSON、`comparison.json`、前后 PM 审计及 FOK 等价日志。解析报告明确 `productionBundleCertified=false`，不会充当部署批准。

## 防回退与验证

PM 依赖检查现在要求直接导入由 adapter 自身的 dependencies/peer 声明，安装副本存在不能代替声明。Vue 必须采用 optional peer、与 web 宿主声明范围一致，不能作为 adapter 私有 dependency。真实边界命令的内存注入测试证明：删除 `@noble/hashes` 声明，即使安装副本还在，也会拒绝。

| 检查 | 环境及结果 |
| --- | --- |
| 前端完整类型检查 `vue-tsc -b` | 干净 after 夹具，通过 |
| PM钱包、凭据、客户端缓存、经典FOK、行情Hub生命周期及默认关闭相关测试 | 干净 after 夹具，15文件、401项通过，单worker，无重跑 |
| 后端 HMAC、官方SDK签名兼容、CLOB代理及订单读取 | 干净 after 夹具，4文件、14项通过 |
| 入口/声明/解析证据与原行情隔离、默认设置、执行观察保护 | 主目录，6文件、99项通过，含新增声明/peer及解析漂移负向样例 |
| `npm run check:boundaries` | 主目录，通过；PM直接未声明依赖0、直接未知输入0，共享loader/DB不确定记录仍20条 |
| `npm run check:venue-adapter` | exports、内部导入、web消费者及默认冻结检查通过；未使用放行变量 |
| FOK执行等价 | 180组对比、20个确认故障场景、45个原门控场景通过 |
| `npm run check:fok-vps` | 原551项逐项通过；固定manifest/hash未改，等价/共享边界/GTC隔离子检查均通过 |

应用源码、原PM-M、经典FOK、实际HTTP预检、loader、registry、Vite配置/浏览器polyfill及实际发布分类均未修改。本地订单簿与旁路默认关闭，未开启真实浏览器行情长测或生产旁路。

## 结论

**本批依赖声明收口完成，两次干净安装未发现前后端解析漂移，既有FOK保护通过。** 前轮4类宿主/传递依赖归属问题已明确；共享SDK升级、20条loader/DB查找不确定记录、线上旧树及发布控制证据仍按原保守规则处理。本轮不启用PM包frontend-only发布，不改实际发布范围，也不放行生产旁路灰度。未 commit、push 或部署。

# PM/PF 循环分块审查与修复（2026-10-23）

## 结论

问题来自浏览器源码迁移后遗漏更新 Vite 的手动分包路径。共享鉴权实现落入 PM 包，旧 shared 兼容入口反向依赖 PM，导致构建文件环路。修复共享实现的分包归属，并在生产构建中校验最终静态导入图，可以消除当前问题并阻止同类回归。

修复仅涉及构建策略和验证工具；没有修改 PM/PF 采集、凭证、下注、补单或结算实现。当前工作区原有的其他未提交改动保留。本记录描述本地工作区验证，未提交、推送或部署。

## 实际环路与来源

原构建输出：

```text
Circular chunk: venue-polymarket -> venue-predictfun -> venue-shared -> venue-polymarket
```

对生成文件的全部静态导入进行遍历，还可看到 `shared -> PM -> shared` 的短环；原日志的一条警告并不代表只有一条环路。

| 构建依赖 | 对应模块 | 判断 |
| --- | --- | --- |
| PM → PF | PM `auth/l2Auth.ts` 使用的 `@noble/hashes`、ethers 使用的 `aes-js`、Vite preload helper 被归入 PF 包 | 共享依赖同包造成，不是 PM 调用 PF 交易接口 |
| PF → shared | PF transport、collector、bet 等使用 client-core HTTP、模型、桥接和公共函数 | 正常依赖方向 |
| shared → PM | `adapter/shared/changmenAuthToken.ts`、`adapter/shared/index.ts` 转出 `shared/changmenAuthToken.ts`，后者被归入 PM 包 | 错误归属，是切断环路的关键 |

旧规则仅识别 `client/packages/venue-browser/adapter/`，未覆盖迁出的 `venue-browser/shared/`、`contract/`、`polymarket/`。Rollup 的函数形式 `manualChunks` 默认会把未显式分配的静态依赖合并到手动分包，因此“返回 undefined”不能保证一个公共依赖会被单独分包。行为依据：[Rollup manualChunks 文档](https://rollupjs.org/configuration-options/#output-manualchunks)。

## 方案实验

使用同一工作区的真实 Vite 模块图，分别覆盖输出策略，构建时 `write: false`，记录模块归属与警告。

| 策略 | CIRCULAR_CHUNK 警告 | 结果 |
| --- | ---: | --- |
| 原策略 | 1 | PM/PF/shared 形成环路 |
| 仅开启 `onlyExplicitManualChunks` | 16 | 多个平台与自动生成的公共分包互相依赖，不能直接启用 |
| 完全取消手动分包 | 0 | 最大 index 包约 4.88 MB；平台包边界消失 |
| 补齐迁移后共享目录与 PM 目录归属 | 0 | 保留平台分包，最终静态图无环 |

原策略与目录修复实验的模块归属比较：唯一发生变更的模块是 `client/packages/venue-browser/shared/changmenAuthToken.ts`，从 `venue-polymarket` 移至 `venue-shared`。迁出的 PM 运行模块此前已经通过依赖归并进入 PM 包；显式覆盖其目录是保证后续文件归属稳定。

最终依赖关系为 `PM -> PF -> shared` 以及 `PM -> shared`；shared 不再反向引用平台包。PM → PF 的第三方依赖共包仍存在，但已无返回路径。

## 实现与防回归

- `client/web/vite/venueChunks.ts`：集中维护新旧目录归属，统一 Windows/POSIX 路径；新旧共享入口均进入 `venue-shared`，PM 真实实现及兼容入口均进入 `venue-polymarket`。内嵌第三方依赖继续交由 Rollup 分配。
- `client/web/vite/plugins/acyclicChunks.ts`：在生产构建的 `generateBundle` 后置阶段遍历所有输出 chunk 的静态 imports。发现环路立即构建失败，错误包含具体文件链。动态导入不作为静态环路处理；同一 chunk 内的源码环路也不在该检查的范围内。
- 测试使用真实 Rollup 构建迁移兼容入口夹具，确认新规则无环，并故意移除共享实现归属，确认构建门禁能拦截回归；另覆盖源码无环但分包有环、动态导入回链、单包内源码环路及两种路径分隔符。
- 历史迁移门禁对整个 `vite.config.ts` 做完整指纹校验。本次增加独立 `venue-chunk-policy-increment.json` / boundary，在既有历史还原链入口接入精确还原：只有本次完整配置哈希匹配才恢复原配置，并校验新策略及门禁实现。原迁移/FOK 清单、基线与冻结路径均未更改；未知修改仍被拒绝。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck:frontend` | 通过 |
| `npm run app:build` | 通过，循环分块警告为 0 |
| `npm run check:boundaries` | 通过 |
| web 分包策略与环路门禁定向单测 | 24 项通过 |
| 增量证明、浏览器入口退役、RAY 预检历史证明单测 | 16 项通过 |
| RAY 执行修复历史证明单测 | 9 项通过 |
| 独立解析实际 dist 的 ES imports | 90 个 JS 文件，0 个静态环路，0 个缺失静态引用 |
| Playwright 检查 `/` 与 `/sports/football` | 两个入口均挂载；shared、PF、PM、HomeView、SportsWorkspace、pmManualSell 均成功加载执行；捕获 JS 异常为 0 |

最终主要包大小（未压缩 / gzip）：shared 180,836 / 61,813 字节；PF 445,670 / 162,186 字节；PM 2,648,560 / 754,400 字节。修复未以把 PM、PF 合为一包的方式消除警告。

本机诊断证据位于 gitignore 的 `output/chunk-cycle-audit/`：`baseline.json`、`explicit.json`、`auto.json`、`migrated.json`、`final-dist.json`、`build.log`、`boundaries.log`、`browser-smoke.log`。

## 剩余事项与验证边界

- PM 大包、静态/动态混合导入导致部分懒加载失效的警告仍存在，属于后续性能优化范围，不能把它们与这次循环分块问题混为一谈。
- 模块级诊断原有 104 条源码环路记录，其中 63 条不涉及 node_modules，包括 web store 互相引用及 PM GTC 的 `index.ts -> preparation.ts -> index.ts`。目录修复实验中这些记录未增加，最终都没有跨输出文件形成静态环路；本次没有重构这些业务依赖。
- Playwright 使用独立本地生产预览。页面存在证书/插件/会话门控，初次访问曾出现远端证书请求 `ERR_BAD_SSL_CLIENT_AUTH_CERT`。验证覆盖应用入口挂载和指定模块初始化，未完成真实登录后的主界面操作、钱包派生或真实下注/卖出。
- Tabbit CLI 因本机浏览器注册失效无法建立任务，因此使用 Playwright CLI 完成浏览器检查。

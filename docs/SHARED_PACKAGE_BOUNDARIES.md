# 共享包如何划分前端与后端

第四轮依赖核对，2026-10-15，代码基线 `9aa9159c`。本轮不拆包、不移动代码、不调整发布分类。

共享包不需要复制为前后端两套。优先保留同一份协议与纯逻辑，将浏览器专属实现、Node 专属实现和双端共用内容通过明确入口隔离。包名和目录名不能作为“只需发布前端”的证据。

## 已核对的入口

| 包或入口 | 消费证据 | 判断 |
| --- | --- | --- |
| `api-contract` | `client/web/src/api/client.ts` 使用 envelope 和 URL；backend workspace 声明依赖并消费 action/DTO | HTTP 协议继续共享，不能复制成可能漂移的两套定义 |
| `shared` | package exports 提供 catalog、时间、赔率、账号与订单公共规则；Node loader 的 `requireShared()` 动态解析这些入口；Vite 将其打入共用 chunk | 按入口核对，不能将整个包归为浏览器专用，也不能仅凭存在 `.browser.ts` 宣称无 Node 关联 |
| `shared/catalog/game_catalog.browser.ts` | 只是转导出 `game_catalog.js` 的子集；原实现还包含 `process.env.AGGREGATE_GAME_CODES` 的 Node 配置读取 | 已有面向浏览器的入口；未来可进一步分离纯目录计算与 Node 配置，但需要保持默认值和筛选语义 |
| `client-core` | `client/web/src/api/client.ts` 使用 `shared/a8Axios`，adapter 声明依赖 | 面向客户端的能力有独立归属；不能据此假定其每个文件都已经证明只被浏览器消费 |
| `venue-adapter/loader` | backend 的 `core/shared/adapter_paths.js` 转导出 loader；loader 动态提供 `requirePlatform` 和 `requireShared` | Node 加载入口，不能搬成前端独占包 |
| `venue-adapter/contract`、`registry`、共享 manifest | 浏览器 runtime 使用 contract，客户端注册 adapter；Node resolver 声明 adapter 依赖，loader 使用 registry/manifest | 双端或构建共享，后续首轮发布分类仍保守处理 |
| 平台 adapter 的采集/下注实现 | 浏览器 Vite alias 指向整个 adapter 包，按场馆产生 chunk；部分平台 shared 子目录也允许 Node 消费 | 只有追踪实际 import、动态加载和构建输入后，才能逐文件认定浏览器专属 |
| adapter 的瘦包构建 | `scripts/sync-backend-bundle.mjs` 会复制 registry、loader、shared、contract 等基础目录；可选参数还能包含浏览器源码 | 搬目录或裁剪发布必须检查生成产物，不能只搜索静态 import |
| `@changmen/db` | `server/db` 独立数据包；backend 通过公开领域入口消费 | 已经是服务端专属；浏览器不得依赖其实现或 RDS 结构 |

## 后续执行顺序

1. 为候选“浏览器专属”入口建立消费者清单：静态 import/re-export、动态 loader、Vite alias、瘦包同步、workspace 和 lockfile。
2. 先限制入口和依赖方向，再考虑是否拆成不同 npm workspace。双端纯逻辑只有一份；Node 连接池、文件系统、鉴权密钥与浏览器 DOM、采集会话各归所属端。
3. 用负向样本证明：浏览器专属实现一旦新增服务端或构建消费者，检查会失败，发布分类不能继续省略后端。
4. 最后按实际消费者调整发布范围，保留共享协议、manifest、loader 与未知路径的保守规则。

当前 `check:boundaries` 已限制服务端访问平台实现并检查各层方向；并不是一个完整的递归依赖图证明。`packages/venue-adapter/package.json` 仍同时包含客户端和服务端依赖，真实风险是环境专属依赖被带入错误入口，需要按上述顺序收口。仅把文件夹改名为 frontend/backend 无法消除这种耦合。

独立修改、独立验证与独立发布应分别判断：数据库查询内部变化通常无需修改前端，但仍需验证既有接口；只有证据充分时才省略另一端发布。详见[解耦方案批次 4](FRONTEND_BACKEND_RDS_DECOUPLING_PLAN.md#批次-4-缩小发布范围)。

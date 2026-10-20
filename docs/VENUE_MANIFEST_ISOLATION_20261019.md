# 平台 catalog 单源维护与隔离（第三轮）

[changmen 扩展] 本轮以 `17afa9c5c39331c9945b5fdf45f7c63738b80b4f` 为起点，将平台目录的维护源归入共享包，保持现有业务逻辑、平台定义与资源选择语义不变。

## 维护与消费者

唯一维护文件是 `packages/shared/catalog/venue_manifest.json`，通过 `@changmen/shared/catalog/venue_manifest.json` 导出。修改它后执行：

```text
npm run sync:venue-manifest
npm run check:venue-manifest
```

主资产和两个生成副本一起提交；不得分别手工维护。同步保留原始字节与数组顺序，不转换字段；检查发现缺失或漂移立即失败，不写文件。检查已接入 `check:boundaries`，继而进入现有 CI。同步先验证主资产、公共导出和全部目标路径，拒绝越出工作目录的链接目标。

| 消费者 | 实际读取位置 |
| --- | --- |
| 浏览器 registry 元数据、图标及图标生成工具 | `packages/venue-adapter/registry/manifest.json`，生成副本 |
| Node registry 及原公共 catalog 导出 | `server/venues/registry/manifest.json`，生成副本 |
| loader 资源根探测 | 原 `registry/manifest.json` 路径标记，规则不变 |
| 默认后端瘦包工具 | 经 shared 公共导出读取主资产，并写入产物原位置 |
| 指定外部目录的瘦包工具 | 外部源自己的 `registry/manifest.json` |

保留两个运行副本是为了保持现有 JSON 导入、相对路径与外部覆盖语义。只有一份人工维护源；这不表示旧资源目录已经退役。未搬迁浏览器 adapter，未缩小发布范围，未启用精简生产安装。

## 行为保持与检查范围

- 17 个平台的定义与起点一致；按 LF 规范化的 SHA-256 为 `4d6b1c5689a3cb3ac1b963cd534386029cdddd726e0eff050c6247fde70bd43a`。
- Node loader/paths/feeds、浏览器 meta/icons、图标生成脚本及生成 CSS 共 7 个关键文件完整内容未变。未修改采集、下注、鉴权、合场或数据库逻辑。
- 瘦包工具直接声明 shared 依赖，锁文件只增加对应本地依赖关系；925 个外部依赖条目未变。缺少主资产时，在替换现有产物之前失败。
- `CHANGMEN_ADAPTER_ROOT`、`GAMEBET_ADAPTER_ROOT` 的独立外部 catalog、平台别名、预加载和缓存重置均通过真实原生模块测试。
- 原完整源码保护通过 5 个文件的精确前后 hash/补丁证明衔接；不改历史基线，不扩大目录豁免，额外源码变化仍不能通过还原。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 新 catalog 回归与第二轮迁移回归 | 22 项通过，其中本轮新增 13 项 |
| Actions 同命令 verification-control | 103 个文件、2,698 项通过 |
| `npm run test:checks` | 边界、包导出、契约与 24 步 catalog smoke 通过 |
| backend workspace 测试 | 883 项通过、16 项原有跳过；另有登录/在线状态 2 项及瘦包运行验证通过 |
| registry 前端单测 | 2 个文件、9 项通过 |
| 独立 node:test | 9 项通过 |
| 后端独立安装实验 | 完整/定向离线安装、路由编译、原生 loader 及共享 catalog 瘦包验证通过；源码指纹稳定 |
| 后端安装解析比对 | 386 个文件、1,053 个字面量引用无解析偏差、无未解析项；原有 11 个动态未知输入保留 |
| 前端独立安装实验 | 仅 8 个前端/工具 workspace，无 server 和旧客户端包目录；离线安装、vue-tsc 与 Vite 生产构建通过，锁文件未变 |
| 资产、依赖与格式 | 三份 catalog 字节一致，外部依赖未变，`git diff --check` 通过 |

各组有交叉覆盖，不累计为单一总数。日志与行为比对报告位于本机 `output/venue-manifest-isolation-20261019/`；后端独立安装完整报告另见 `output/backend-install-isolation/verdict.json`。安装实验关闭生命周期脚本，不能据此认证 Linux 原生可选依赖或完整动态运行闭包。前端构建存在既有大 chunk 提示。

第二轮发布 Actions `39245798573` 已成功；本轮开始时确认前后端部署版本均为 `17afa9c5`，并经服务器本机只读请求确认 backend 健康、数据库已连接。当前机器公开 API 的 HTTPS 请求遇到本地 TLS 错误，因此不能将该次结果当作公网 API 验证通过。

本轮尚未 commit、push 或部署；上述验证针对本地候选改动。未执行生产数据库迁移或写入。开始前已有的架构文档、matcher README 和其他计划/审计文档不纳入本轮修改。

## 同日再次复核

逐项复核同步器、瘦包工具、依赖声明、精确源码证明和现有发布链路，未发现本轮新增的业务回归或阻塞问题。本次没有修改运行代码。

- catalog、Node 迁移与安装声明三组回归共 51 项通过；边界检查通过。
- 发布计划、发布分类及工作流测试共 30 项通过。三个 catalog 路径均纳入前后端版本指纹，并按 full、后端先行处理。
- 再次比对确认 17 个平台定义、7 个关键运行/生成文件及 925 个外部依赖条目未变。三份 catalog 经 Git 换行规范化后的对象 hash 一致，`git diff --check` 通过。
- 复验日志见 `review-targeted.log`、`review-boundaries.log`、`review-release.log`。此前独立安装和构建结果仍适用于未改动的候选代码；本次不重复数据库演练，也不执行生产迁移或部署。

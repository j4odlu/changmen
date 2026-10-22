# 浏览器 adapter 目录隔离：第四轮首批

> [changmen 扩展] **文档状态（2026-10-22）：历史迁移与验收记录。文中的旧目录、兼容入口、workspace 数量、未提交及未部署状态仅对应各自批次；当前布局见 [WORKSPACE_LAYOUT](./WORKSPACE_LAYOUT.md)，安装与发布见 [INDEPENDENT_DEPLOYMENT](./INDEPENDENT_DEPLOYMENT.md)**

[changmen 扩展] 本轮以已上线的 aecea38cc30a31bdb2028be655cb6ac40f7df470 为基线，迁移 10 个浏览器专属实现，保持原业务行为。

## 最终范围

- 唯一实现：client/packages/venue-browser/pm-book-diagnostics/ 的 9 个模块，以及 pm-book-source.ts。
- 原 packages/venue-adapter/browser/ 保留 10 个精确转发入口；更早的 polymarket 公共入口不变。原观察槽、运行类和只读 source 对象仍为同一实例。
- 实现只调整指向原行情工具的相对 import 路径，其余全文与起点一致。没有改变计时、价格计算、HTTP 请求、Worker 协议、错误处理、默认开关或采集/下注流程。
- 归属检查、Node 禁入、安装源码目录及前后端版本指纹覆盖新位置。发布范围保持 full、后端先行；未更改生产安装或归档流程。

## 尚未完成的独立包边界

本目录仍归现有私有 @changmen/venue-adapter workspace，不能单独作为 npm 包安装。新目录复用旧 adapter 的行情工具，旧 adapter 又消费本目录，因此先行拆成两个 workspace 会形成构建循环。本轮验证发现这一点后取消了新包方案，没有通过关闭依赖检查绕过循环。

最终 package.json、package-lock.json 和 adapter 的依赖声明均与起点一致。venue-browser-layout.mjs 明确新目录的依赖归属；declaredInstallClosure 的 sourceDirectories 显式登记安装时还需复制的源码，workspaceDirectories 继续仅描述 npm 工作区。后续解除这段反向依赖后再独立拆包。

## 验证与证据

迁移证明记录为 scripts/verification/venue-browser-relocation.json：逐文件校验旧入口、唯一实现 hash，以及仅相对路径替换后还原的完整原文。新源码被改动、丢失，或旧入口增加实现，均使检查失败；原历史基线不变。

新增 scripts/testing/frontend-install-isolation.mjs，在临时目录仅复制前端声明的源码，关闭安装生命周期脚本，离线安装后执行类型检查和生产构建。临时目录没有 server 和旧 client-core/arb-core 源码目录；结束后验证锁文件和 workspace 链接并清理临时文件。

本机日志位于 output/venue-browser-isolation-20261019/，独立安装详细报告分别位于 output/frontend-install-isolation/、output/backend-install-isolation/。最初独立包方案的构建循环和兼容入口数量断言失败保留在 *-initial.log，最终结果以复验记录为准。

首批已提交并推送至 master：3126c8de0462aaca96b96be432618fd852285755。Actions 39252959950 完成前后端部署。没有执行数据库迁移；原有架构文档、matcher README 及其他用户计划/审计文档未纳入提交。

## 最终验证结果

| 检查 | 结果 |
| --- | --- |
| 迁移、兼容、旧元数据与运行身份相关回归 | 5 文件 38 项通过；其中新增迁移检查 5 项，原身份断言补齐新目录 |
| Actions 同命令 verification-control | 104 文件、2,703 项通过 |
| 前端完整测试 | 522 文件通过、3 个原有跳过；4,806 项通过、4 个原有跳过 |
| 前端类型检查 | vue-tsc 通过，Turbo 无循环依赖 |
| test:checks | 边界、包导出、契约与 24 步 catalog smoke 通过 |
| 前端独立安装与生产构建 | 8 个 workspace、9 个源码目录，无 server；离线安装、类型检查、Vite 生产构建通过 |
| 后端独立安装 | 完整和定向安装、路由编译、原生 loader、registry 与瘦包验证通过；没有复制新浏览器目录 |

不同测试组有交叉，不累加为单一总数。前端构建仍有既有大 chunk 及静态/动态导入重叠提示；安装实验关闭生命周期脚本，不代替 Linux 生产环境验收。

## 上线验收

2026-10-19 20:43（Asia/Taipei）完成首批上线只读验收。前后端版本均为 3126c8de，8 个预期 PM2 服务在线且指向当前发布目录，RDS 连接及内嵌 matcher 正常，restartRequired=false。124 秒观察窗口内 PID 和重启计数保持不变，无新增模块加载、语法或引用错误；主 backend 错误日志无新增字节。采集日志仍有 cycle-ok 输出和赛事未匹配提示。

公开首页、入口 JS、CSS 与服务器发布文件的 SHA-256 一致。第一次本机直连下载 JS 超时，改用本机 HTTP 代理后完成全部内容校验。数据库结构指纹保持 2ccbe256dd7501978d2207668ff94fc46d98787074978f4460f9efbc8b8e6158。证据位于 output/venue-browser-isolation-20261019/release-verdict.json 及相关 release-*.json。本次未执行登录后的 UI 操作或真实下单验收。

后续纯工具拆分是本地独立批次，见 [VENUE_BROWSER_LEAVES_20261019.md](./VENUE_BROWSER_LEAVES_20261019.md)，不包含在上述线上版本中。

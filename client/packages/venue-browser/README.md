# 浏览器 adapter 实现目录

[changmen 扩展] pm-book-diagnostics/ 和 pm-book-source.ts 是从 packages/venue-adapter/browser/ 迁入的唯一实现。旧路径仅转导出，历史公共入口、观察槽、运行类和 source 对象保持相同身份。

本目录暂属于现有私有 @changmen/venue-adapter workspace，**不是独立 npm 包**。实现仍复用原 adapter 的行情工具，独立包之间会形成反向依赖；本轮只完成物理目录隔离。没有新增 package.json、workspace、依赖或发布入口。

scripts/verification/venue-browser-layout.mjs 登记依赖归属；declaredInstallClosure 的 sourceDirectories 包含工作区源码及本目录，复制安装输入时应使用它，npm workspace 清单仍使用 workspaceDirectories。独立前端安装验证入口为 node scripts/testing/frontend-install-isolation.mjs。

Node 运行入口禁止到达本目录。完整源码、旧转发入口和保守发布范围由边界检查持续验证；本地簿及对照的默认开关和实际预检路径均未改变。

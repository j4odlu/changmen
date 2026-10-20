# @changmen/venue-adapter

[changmen 扩展] 本目录保留用于兼容验证的 manifest 及旧验证命令。浏览器实现和测试已迁入 [client/packages/venue-browser](../../client/packages/venue-browser/README.md)，595 个旧浏览器文件及 4 个旧 Node 运行入口已删除。

## 当前边界

- Web 依赖 @changmen/venue-browser，使用其 adapter/ 子路径；不再依赖本包，也没有旧包的 Vite/TS 别名。
- 本包没有运行时 exports；旧 loader 别名已退役，不能重新生成。
- Node loader / registry 实现分别位于 server/packages/venue-node-loader 和 server/packages/venue-node-registry；消费者使用 @changmen/venue-node、@changmen/venue-node-registry。
- registry/manifest.json 是生成副本，唯一维护源为 packages/shared/catalog/venue_manifest.json。修改后执行 npm run sync:venue-manifest。
- 后端打包工具实现位于 [server/packages/venue-adapter-tools](../../server/venues/README.md)，旧 scripts/sync-backend-bundle.mjs 已删除。保留的 npm 命令直接调用服务端工具 workspace。默认资源根位于 Node registry workspace 的 runtime/；后端安装不复制本目录。

新增浏览器平台请按[新增平台清单](../../docs/ADD_PLATFORM_CHECKLIST.md)修改客户端包。可选 Node 探针位于 [server/platform-probes](../../server/platform-probes/README.md)。

## 检查与维护

执行 npm run check:venue-adapter 和 npm run check:boundaries。

旧 check:web-imports 命令拒绝所有旧包浏览器子路径。旧 sync:exports 命令保持 exports 为空，发现旧引用时失败，不会重新创建浏览器或 Node 导出。前端维护工具主实现位于 client/devtools/venue-adapter/，旧 scripts 保留命令委托入口。

浏览器迁移与退役清单位于 scripts/verification/adapter-browser-relocation.json、browser-entry-retirement.json；Node 入口退役清单位于 scripts/verification/node-entry-retirement.json。历史源码视图仅用于验证，不参与运行时解析；真实文件系统检查拒绝旧入口返回，并确认 server/ 外没有后端实现或入口。原冻结清单和 551 项保护基线保持不变。

此前各轮迁移背景见[源码隔离记录](../../docs/SOURCE_FILE_ISOLATION_20261017.md)。历史文档中的旧浏览器路径仅作追溯，当前开发入口以客户端包 README 为准。

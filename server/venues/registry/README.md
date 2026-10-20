# @changmen/venue-node-registry

[changmen 扩展] 服务端平台清单读取包。公开 `paths.js`、`feeds.js` 和 `manifest.json`；浏览器实现归属 `client/packages/venue-browser`。

`runtime/` 是 Node loader 的默认资源根，由本 workspace 的 `files` 清单交付，包含 registry 内部转导出和生成的 manifest。`CHANGMEN_LAYOUT.venueAdapter` 指向这里；backend 安装不需要复制旧 `packages/venue-adapter` 源码或资源。

唯一维护源仍是 `packages/shared/catalog/venue_manifest.json`。执行 `npm run sync:venue-manifest` 同步三个生成副本；`npm run check:venue-manifest` 检查一致性。原旧目录副本用于兼容验证，不是后端默认资源根。

Node loader 的缓存、registry 状态和平台模块身份保持一致。`CHANGMEN_ADAPTER_ROOT` / `GAMEBET_ADAPTER_ROOT` 仍可指定包含 `registry/manifest.json` 的外部资源根；平台探针的单独覆盖规则也保持不变。

后端瘦包工具从本资源根及 Node 公共入口生成自包含产物，默认输出路径仍为 `server/backend/platform_adapter`。独立安装验证使用 `node scripts/testing/backend-install-isolation.mjs`；它不启动生产服务或连接生产数据库。原冻结清单和 551 项源码保护基线不变。

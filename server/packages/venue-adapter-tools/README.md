# @changmen/venue-adapter-tools

[changmen 扩展] 服务端拥有的 adapter 瘦包工具。实现归属本目录，公开包名及命令保持不变：

```text
npm run sync:backend-bundle --workspace=@changmen/venue-adapter-tools
```

公开模块入口为 `@changmen/venue-adapter-tools/sync-backend-bundle.mjs`，导出 `syncPlatformAdapterBackendBundle({ src, dst, includeBrowserSources })`。backend 的 `sync:platform-adapter` 仍按 adapter、platform-probes 的顺序执行。

默认资源根为 `server/packages/venue-node-registry/runtime`，默认输出仍为 `server/backend/platform_adapter`。共享 catalog 是默认 manifest 的唯一来源；显式外部 `src` 保留自己的 manifest。浏览器源码仍默认排除，`includeBrowserSources` 保持显式外部目录的选择行为。

旧 `packages/venue-adapter/scripts/sync-backend-bundle.mjs` 已删除，模块消费者直接使用本包；保留的旧 npm 命令直接调用本 workspace。默认生成从公开 Node loader/registry 入口物化实现及本工具，产物可脱离 workspace 运行；不再读取旧 adapter 资源根。显式外部目录中的已知旧委托仍能物化，已有自包含模块保持原样。

本包直接声明共享 catalog、storage、Node loader 和 Node registry 依赖，不引入浏览器 workspace 或 Vue。生成前先读取所需实现，源目录与目标目录重叠时拒绝操作。验证入口：

```text
npm run check:boundaries
node scripts/testing/backend-install-isolation.mjs
```

后者在临时目录内离线安装，禁用生命周期脚本，不启动服务或连接生产数据库。八进程安装闭包通过与全量安装比较模块解析和路由编译来验证；动态路径及 Linux 原生依赖的完整运行认证仍需后续完成。生产安装和发布范围没有改变。

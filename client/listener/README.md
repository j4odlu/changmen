# 独立盘口监听模块与页面入口

[changmen 扩展] 两版使用同一份 `client/web/src/main.ts`、App、页面、账号、配置、主循环及交易代码。监听功能集中在 [module/index.ts](./module/index.ts)，职责和接口见 [模块说明](./module/README.md)。开发使用独立模块图，生产分别构建后合入同一个前端发布包，一起发布和回滚。

公共业务只需修改原源码。2026-10-30 起，`npm run dev` 同时提供两版源码加载与热更新，监听页面不再依赖 `build/dist`，不需要手动重建。

## 使用

从仓库根执行：

```powershell
npm run dev
```

原版地址为 `http://localhost:5576/`；监听版为 `http://localhost:5576/listener`，末尾带斜杠也可。当前端口来自原 `client/web/.env.local`。`npm run app:dev` 与直接启动 web workspace 的 dev 命令同样支持两版。

`client/web/vite/plugins/listenerDev.ts` 仅在访问监听入口时启动独立模块图，以 `/__listener/` 承载源码请求。它复用现有监听 alias、Vue 插件和环境配置，挂在同一个 HTTP 服务上，不另占端口。HMR 使用 `/__listener/hmr`，与普通版分开；原版模块映射保持原样。关闭开发服务时会关闭该模块图。该插件不参与生产构建。

两个旧的预构建 HTML 加载器已删除，由开发插件直接提供页面，避免 Vite 扫描尚不存在的构建文件。独立构建命令保留用于检查。首次编译/依赖优化可能需要等待，后续共享源码修改由 Vite 更新两版。修改配置文件时 Vite 会重启开发服务。

页面同源共享原 Cookie、登录和 API。账号及下注、补单、扩展策略均按原配置运行，没有用户名白名单或强制关闭下注。同一用户不同时打开两版是用户确认的使用前提。

## 当前目录

| 路径 | 用途 |
| --- | --- |
| `module/` | 监听源码、原启动文件的导入入口与接入适配 |
| `build/` | 构建、类型检查、审计配置；`dist/` 存产物，`.reports/` 存核验基线与报告，`.cache/` 按需缓存 |
| `tests/` | 监听模块、原业务兼容及构建边界测试 |

历史离线实验页、回放、旧队列及其测试、旧构建入口和过期临时报告已经删除。2026-10-29 将原适配目录并入 `module/`，两组有效测试合入 `tests/`，产物与报告收进 `build/`，顶层只保留三个目录。独立检查只写本目录；正式构建最后将监听产物合入 `client/web/dist`。

监听独立验证仍可运行 `node client/listener/build/live.mjs check` 与 `node client/listener/build/live.mjs compat`；开发加载与热更新回归位于 `client/web/vite/plugins/listenerDev.test.ts`。前端常规回归已包含监听测试和共享交易兼容回归。所有自动交易验证使用 mock。详见 [实现与验收记录](./LIVE_IMPLEMENTATION_REPORT.md)。

## 生产构建（2026-11-06）

运行 `npm run app:build`，得到同一个 `client/web/dist`：`/` 为普通版，`/listener/` 为监听版，监听 JS/CSS 位于 `/assets/listener/`。监听使用正式环境及现有 Cookie/API；路由仍采用 hash。构建分别检查两版类型与依赖图，普通版不引入监听 alias。版本信息覆盖两版源码，监听页与普通页共享发布版本。

沿用现有 GitHub Actions 前端归档、原子切换、旧资源保留与回滚。发布健康检查必须读取真实监听 HTML 和入口 JS；监听异常会恢复整个前端上一版。无需增加服务或独立部署流程。本次接入不代表已推送或上线。

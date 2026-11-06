# 盘口监听模块

[changmen 扩展] 本模块负责逐盘口订阅、通知合并、串行执行和监听生命周期。通用页面、登录、账号、配置、采集、初赔、主循环、补绑/补单和交易业务统一来自 `client/web/src` 及原共享包。

## 入口与职责

公共入口为 `index.ts`：

- `installListenerStore(store)`：接入原 store。启动、停止和拉列表均调用原动作；原 `runMainLoopTick` 和 `scheduleMainLoop` 方法保持原引用。
- `runListenerMaintenance(run)`：将原主循环体串行接入。原宿主继续负责状态更新、原 finally、等待和下一轮定时，不在模块中复制这些实现。
- `runA8ArbRound(context)`：消费收到通知的盘口，按原列表顺序调用原执行入口。
- `drainListenerRuntime()`：停止未来监听并等待正在运行的执行体，用于退出/测试收尾。
- `listenerState`：模块内存统计，不新增用户设置或强制下注开关。

`subscriptions.ts` 负责 Vue 响应式依赖和开赛时间唤醒；`serialRounds.ts` 负责执行体串行和停止时取消待执行任务；`runtime.ts` 接入原规则与执行函数；`rounds.ts` 负责与原调度的接口绑定。

## 公共逻辑修改如何同步

两版都运行同一个 `client/web/src/main.ts`，同一个 App、router、store 和交易/维护实现。本目录的 `bootstrap.ts` 只有一条导入语句，`matchStore.ts`、`mainBetLoop.ts`、`arbRound.ts` 负责接入适配。监听构建在内存中适配 router history 和鉴权返回 URL，不复制或写回原路由、鉴权文件。

修改 `client/web/src` 或原共享包内的公共业务后，无须把代码复制到监听目录。开发时只运行 `npm run dev`，两版都通过同一端口加载当前源码并接收 HMR；监听 alias 由独立模块图处理，普通版不会采用这些 alias。开发接入位于 `client/web/vite/plugins/listenerDev.ts`，只在访问监听地址时初始化，不读取预构建产物。独立构建仍用于检查，正式构建采用下述同包发布方式。

变更原接入点的函数签名、路由 history 或鉴权跳转表达式时，应一同运行监听类型检查和兼容回归；契约不匹配会失败，避免静默沿用旧副本。原版业务不导入本模块。生产通过 `npm run app:build` 分别构建后合入同一前端制品，监听入口为 `/listener/`，两版一起发布和回滚。

## 验证

```powershell
node client/listener/build/live.mjs check
node client/listener/build/live.mjs compat
node client/listener/build/audit.mjs verify
```

测试包含原启动/停止委托及定时方法引用、原执行链兼容、按盘通知、合并、串行、错误恢复、停止及原配置/鉴权/路由适配。构建图强制包含原启动、store、主循环与执行阶段，禁止原全量套利扫描入口和服务端实现进入监听产物。

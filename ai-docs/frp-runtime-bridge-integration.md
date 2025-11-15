# FrpRuntime + FrpBridge 集成指南

> 目标：让上层应用只面对统一导出的 `FrpBridge` API；原先的 `FrpBridge` 类改名为 `FrpProcessManager`，专注进程与配置落地，`FrpRuntime` 继续承担纯逻辑职责。

## 1. 角色定位
- **FrpRuntime**：纯逻辑运行时，负责命令路由、事件缓冲、版本号管理、快照存储，可在任意环境中（Node、浏览器、Serverless）安全执行。
- **FrpProcessManager**（旧 `FrpBridge`）：系统管家，负责下载 FRP 二进制、读写 TOML 配置、启动/停止进程，只能在具备文件系统与子进程能力的环境中运行。
- **FrpBridge（新的对外入口）**：对 Runtime 与 ProcessManager 进行编排，为用户提供“发送命令 / 查询状态”的唯一 API。

可把 Runtime 理解为“脑子”，ProcessManager 是“手脚”，新的 FrpBridge 则是“中枢神经”，负责调度二者并对外暴露清晰接口。

## 2. 默认配置与依赖
- **必填 mode**：`new FrpBridge({ mode: 'client' | 'server' })`，构造函数不会推断模式，Runtime 也默认与该 mode 保持一致，除非外部显式覆盖。
- **目录划分**：若未显式传入 `workDir`，FrpBridge 使用 `join(homedir(), '.frp-bridge')` 作为根目录，并自动创建 `runtime/` 与 `process/` 子目录；若提供 `workDir`，会在其下继续划分子目录，避免互相污染。
- **快照存储**：默认启用文件型 `SnapshotStorage`，快照写入 `<workDir>/runtime/snapshots`，持久化版本、校验和与作者信息；无可写权限时需要调用方显式传自定义存储。
- **日志**：FrpRuntime 与 FrpProcessManager 默认接入 `consola`（继承 Nuxt Node 端的输出）；也可以通过 `FrpBridgeOptions.runtime.logger` 或外层注入自定义 logger。
- **内建命令/查询**：
  - Commands：`config.apply`（写 TOML + `start()`）、`process.stop`（停止进程）、可选扩展 `process.restart`、`binary.update`。
  - Queries：`process.status`（返回运行态与当前配置）、`runtime.snapshot`。
- **事件与队列**：Runtime 继续维护事件缓冲，FrpBridge 暴露 `drainEvents()`；若提供 `eventSink`，则在 emit 时同步分发。

## 3. 推荐整合方式
1. **统一入口**：新 `FrpBridge` 内部持有 `FrpRuntime` 与 `FrpProcessManager`，其构造函数接收运行时上下文、命令/查询插件及落盘选项，并对外暴露 `execute`/`query`/`snapshot` 等方法。
2. **命令驱动**：Runtime 的 command handler 里调用 ProcessManager，确保所有配置落盘、进程启停都经过 Runtime 命令通路，便于审计与回放。
3. **事件透出**：ProcessManager 完成动作后，通过 Runtime 的 `emit` 将事件（如 `config:version-bumped`、`process:started`）推送给上层，保持状态单一来源。
4. **查询按需下钻**：Runtime 的 query handler 可直接访问 ProcessManager，读取实时配置或进程状态，再返回给调用方。

## 4. 参考代码
```ts
import { FrpBridge } from 'frp-bridge'
import { FrpProcessManager } from 'frp-bridge/process'
import { FrpRuntime } from 'frp-bridge/runtime'

export class FrpBridgeImpl implements FrpBridge {
  private readonly runtime: FrpRuntime
  private readonly process: FrpProcessManager

  constructor() {
    this.process = new FrpProcessManager({ mode: 'client' })
    this.runtime = new FrpRuntime(
      { id: 'main', mode: 'server', workDir: '/var/frp', platform: process.platform },
      {
        commands: {
          'config.apply': async (command, ctx) => {
            this.process.updateConfig(command.payload.config)
            await this.process.start()
            ctx.requestVersionBump()
            return { status: 'success', events: ctx.state.status === 'idle' ? [{ type: 'process:started', timestamp: Date.now() }] : [] }
          },
          'process.stop': async () => {
            await this.process.stop()
            return { status: 'success', events: [{ type: 'process:stopped', timestamp: Date.now() }] }
          }
        },
        queries: {
          'process.status': async () => ({
            result: { running: this.process.isRunning(), config: this.process.getConfig() },
            version: this.runtime.snapshot().version
          })
        }
      }
    )
  }

  execute(command) {
    return this.runtime.execute(command)
  }

  query(query) {
    return this.runtime.query(query)
  }
}
```
> 关键：所有写操作（配置、进程）都走 Runtime 命令，读操作通过 Runtime 查询；这样无论是 CLI、服务端 API 还是 UI，都只依赖 Runtime 抽象。

## 5. 在 frp-web 中落地
1. `pnpm add frp-bridge`（或使用已建立的本地 link/tarball）。
2. 删除 `core/runtime` 目录，把 `@/core/runtime` 等导入改成 `frp-bridge/runtime` 或直接使用对外导出的 `FrpBridge`。
3. UI / API 仅与新的 `FrpBridge` 实例交互：
  - `FrpBridge.execute(command)` -> Runtime -> ProcessManager（写操作）
  - `FrpBridge.query(query)` -> Runtime（读操作）
4. 运行 `pnpm lint`、`pnpm dev`（或 CI 任务）确认没有遗留引用。

## 6. 进一步建议
- **扩展存储**：默认文件型快照适合单机场景；若需多实例共享，可实现基于数据库/对象存储的 `SnapshotStorage` 并通过 `FrpBridgeOptions.storage` 注入。
- **错误追踪**：将 ProcessManager 抛出的错误封装为 `RuntimeError`，便于统一处理与透出。
- **测试策略**：Runtime 命令可用纯单元测试覆盖；ProcessManager 行为通过集成测试验证（需真实或模拟文件系统）。

将上述模式固化后，用户面对的就是“发送命令 / 查询状态”的统一接口，底层如何下载二进制、写 TOML、启动进程都被屏蔽在 `FrpBridge` 内部。

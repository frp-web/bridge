# FrpProcessManager 拆分方案详细设计

一、现状分析

当前 FrpProcessManager 承担的职责：

1. 进程生命周期管理
   - spawn、stop、restart、isRunning
   - 进程事件监听（exit、error、disconnect）

2. 配置文件管理
   - 读取、写入、更新配置（TOML格式）
   - 配置合并和验证

3. 二进制文件管理
   - 下载、解压、版本检测
   - 路径管理和可执行权限设置

4. 隧道管理（Client模式）
   - 增删改查 Proxy 配置
   - 隧道名称唯一性校验

5. 平台兼容性处理
   - 跨平台解压（tar.gz vs zip）
   - 权限设置（Unix chmod）

6. 版本管理
   - 获取最新版本（GitHub API）
   - 指定版本下载
   - 本地版本检测

7. 备份管理
   - 配置文件备份

代码行数: 600+ 行
职责数量: 7 个主要职责
违反原则: 单一职责原则（SRP）

二、拆分原则
=================================================================

1. 单一职责原则（SRP）
   每个类只负责一个明确的业务领域

2. 开闭原则（OCP）
   对扩展开放，对修改关闭

3. 依赖倒置原则（DIP）
   依赖抽象而非具体实现

4. 接口隔离原则（ISP）
   客户端不应依赖它不需要的接口

三、新架构设计
=================================================================

架构层级:

┌─────────────────────────────────────┐
│      FrpOrchestrator (编排层)        │  ← 对外API，协调各组件
├─────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐ │
│  │ ProcessCtrl  │  │ ConfigStore  │ │  ← 核心领域服务
│  └──────────────┘  └──────────────┘ │
│  ┌──────────────┐  ┌──────────────┐ │
│  │ BinaryMgr    │  │ TunnelMgr    │ │  ← 业务逻辑层
│  └──────────────┘  └──────────────┘ │
├─────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐ │
│  │VersionSvc    │  │ BackupSvc    │ │  ← 支撑服务层
│  └──────────────┘  └──────────────┘ │
│  ┌──────────────┐  ┌──────────────┐ │
│  │ FileSystem   │  │ ProcessSpawn │ │  ← 基础设施层
│  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────┘

四、核心类拆分设计
=================================================================

1. ProcessController（进程控制器）
-----------------------------------------------------------------

职责: 纯粹的进程生命周期管理，不关心配置、二进制、隧道等

核心方法:
  - start(binaryPath: string, configPath: string): Promise<ProcessHandle>
  - stop(handle: ProcessHandle): Promise<void>
  - restart(handle: ProcessHandle): Promise<ProcessHandle>
  - getStatus(handle: ProcessHandle): ProcessStatus
  - attachEventListener(handle: ProcessHandle, listener: ProcessEventListener): void

内部状态:
  - activeProcesses: Map<string, ProcessHandle>
    管理多进程实例（为未来扩展做准备）

  - eventEmitter: EventEmitter
    进程事件分发器

设计要点:
  ✓ ProcessHandle 是不透明对象，包含：
    - pid: number
    - startTime: number
    - stdout: Readable
    - stderr: Readable
    - exitCode: number | null
    - signal: NodeJS.Signals | null

  ✓ 支持管理多个进程实例
    同时运行多个客户端或多个服务端

  ✓ 进程崩溃自动检测
    监听 exit 事件，区分正常退出和异常退出

  ✓ 优雅关闭机制
    - 先发送 SIGTERM
    - 等待 gracefulTimeout（默认5秒）
    - 超时后发送 SIGKILL

  ✓ 进程健康检查
    - 定期检测进程是否响应（通过端口探测或 IPC）
    - 僵尸进程检测和清理

启动流程详解:

  start(binaryPath, configPath):

    1. 前置验证
       ├─ 检查 binaryPath 是否存在
       ├─ 检查是否有可执行权限（Unix）
       ├─ 检查 configPath 是否存在
       └─ 可选: 检查端口是否被占用

    2. 启动进程
       ├─ 构造启动参数: ['-c', configPath]
       ├─ 配置 stdio 重定向:
       │  - stdin: 'ignore'
       │  - stdout: 'pipe' (用于日志收集)
       │  - stderr: 'pipe' (用于错误诊断)
       ├─ 设置环境变量（如需要）
       └─ 调用 spawn(binaryPath, args, options)

    3. 注册事件监听器
       ├─ process.on('exit', handleExit)
       ├─ process.on('error', handleError)
       ├─ process.on('disconnect', handleDisconnect)
       ├─ stdout.on('data', handleStdout)
       └─ stderr.on('data', handleStderr)

    4. 创建进程句柄
       ├─ 生成唯一 processId
       ├─ 记录启动时间
       ├─ 封装为 ProcessHandle 对象
       └─ 存储到 activeProcesses Map

    5. 启动后检查（异步）
       ├─ 等待 500ms
       ├─ 检查进程是否存活
       ├─ 检查是否有启动错误输出
       └─ 触发 process:started 事件

    6. 返回 ProcessHandle

停止流程详解:

  stop(handle):

    1. 前置检查
       ├─ 验证 handle 有效性
       ├─ 检查进程是否仍在运行
       └─ 标记 isManualStop = true

    2. 发送 SIGTERM
       ├─ 调用 process.kill(handle.pid, 'SIGTERM')
       └─ 记录信号发送时间

    3. 等待优雅退出
       ├─ 启动定时器: gracefulTimeout（默认 5000ms）
       ├─ 监听 exit 事件
       └─ 如果进程自行退出，跳到步骤 5

    4. 强制终止（如果超时）
       ├─ 检查进程是否仍存活
       ├─ 发送 SIGKILL 信号
       ├─ 记录日志: 'Process did not exit gracefully, forced kill'
       └─ 等待 exit 事件（最多 2 秒）

    5. 清理资源
       ├─ 从 activeProcesses Map 移除
       ├─ 移除所有事件监听器
       ├─ 关闭 stdio 流
       └─ 释放文件句柄

    6. 触发事件
       ├─ 触发 process:stopped 事件
       └─ 返回退出信息（exitCode, signal）

重启流程详解:

  restart(handle):

    1. 保存原始配置
       ├─ 提取 binaryPath
       ├─ 提取 configPath
       └─ 保存其他启动参数

    2. 执行停止流程
       ├─ 调用 stop(handle)
       └─ 等待完全停止（监听 exit 事件）

    3. 延迟等待
       └─ 延迟 500ms（确保端口释放和资源清理）

    4. 执行启动流程
       ├─ 调用 start(binaryPath, configPath)
       ├─ 捕获启动错误
       └─ 返回新的 ProcessHandle

    5. 错误处理
       如果启动失败:
         ├─ 记录错误日志
         ├─ 触发 process:restart-failed 事件
         ├─ 可选: 尝试回滚到旧版本
         └─ 抛出 ProcessStartFailedError

状态查询:

  getStatus(handle):
    返回 ProcessStatus 对象:
      {
        pid: number
        running: boolean
        uptime: number  // 运行时长（毫秒）
        startTime: number
        exitCode: number | null
        signal: string | null
        memoryUsage: {
          rss: number
          heapTotal: number
          heapUsed: number
        }
        cpuUsage: {
          user: number
          system: number
        }
      }

事件类型:

  - process:started
    payload: { pid, startTime }

  - process:stopped
    payload: { pid, exitCode, signal, uptime }

  - process:exited
    payload: { pid, exitCode, signal, uptime, unexpected: boolean }

  - process:error
    payload: { pid, error, timestamp }

  - process:restart-failed
    payload: { error, attempts }

2. ConfigurationStore（配置存储）
-----------------------------------------------------------------

职责: 配置文件的持久化、反序列化、验证，不关心业务逻辑

核心方法:
  - load(path: string): Promise<FrpConfig>
  - save(path: string, config: FrpConfig): Promise<void>
  - merge(base: FrpConfig, override: Partial<FrpConfig>): FrpConfig
  - validate(config: FrpConfig): ValidationResult
  - watch(path: string, callback: ConfigChangeCallback): FileWatcher

内部机制:

  - cache: Map<string, CachedConfig>
    缓存结构:
      {
        path: string
        config: FrpConfig
        mtime: number  // 文件修改时间
        cachedAt: number  // 缓存时间
      }

  - serializer: ConfigSerializer
    TOML ↔ Object 转换

  - validator: ConfigValidator
    配置验证器（基于 Schema）

  - fileWatcher: FileSystemWatcher
    文件变更监听（使用 chokidar）

设计要点:

  ✓ 多级缓存策略
    - L1: 内存缓存（基于 mtime 比对）
    - TTL: 5 秒（可配置）
    - 缓存失效条件:
      * 文件 mtime 变化
      * 缓存时间超过 TTL
      * 手动调用 invalidate()

  ✓ 配置文件热重载
    - 使用 chokidar 监听文件变更
    - 防抖处理（300ms）
    - 比对差异，只通知变更的字段

  ✓ 配置合并策略可插拔
    - 默认策略: 深度合并
    - 数组策略: 替换 vs 追加 vs 去重
    - 支持自定义合并器

  ✓ Schema 验证
    - 使用 Zod 或 TypeBox
    - 详细的错误信息
    - 支持配置迁移（版本升级）

  ✓ 原子性写入
    - 先写临时文件
    - 验证成功后 rename（原子操作）
    - 失败自动清理临时文件

加载流程详解:

  load(path):

    1. 缓存检查
       ├─ 检查 cache Map 是否有该路径
       ├─ 如果有缓存:
       │  ├─ 获取文件当前 mtime
       │  ├─ 比对 cachedConfig.mtime
       │  ├─ 检查缓存时间是否在 TTL 内
       │  └─ 如果都满足，返回缓存配置
       └─ 否则继续下面步骤

    2. 文件读取
       ├─ 检查文件是否存在
       ├─ 如果不存在，抛出 ConfigNotFoundError
       ├─ 读取文件内容（readFileSync）
       └─ 获取文件 mtime

    3. 反序列化
       ├─ 调用 serializer.parse(content)
       ├─ 捕获 TOML 解析错误
       └─ 如果解析失败，抛出 ConfigInvalidError

    4. 配置验证
       ├─ 调用 validator.validate(parsedConfig)
       ├─ 如果验证失败:
       │  ├─ 收集所有验证错误
       │  ├─ 构造详细错误信息
       │  └─ 抛出 ValidationError
       └─ 否则继续

    5. 配置迁移（如果需要）
       ├─ 检查配置版本
       ├─ 如果版本低于当前:
       │  ├─ 调用迁移器
       │  ├─ 自动升级配置格式
       │  └─ 记录迁移日志
       └─ 返回迁移后的配置

    6. 更新缓存
       ├─ 创建 CachedConfig 对象
       ├─ 存储到 cache Map
       └─ 记录缓存时间

    7. 触发事件
       └─ 触发 config:loaded 事件

    8. 返回配置对象

保存流程详解:

  save(path, config):

    1. 配置验证
       ├─ 调用 validator.validate(config)
       ├─ 如果验证失败，抛出 ValidationError
       └─ 否则继续

    2. 序列化
       ├─ 调用 serializer.stringify(config)
       ├─ 捕获序列化错误
       └─ 返回 TOML 字符串

    3. 原子性写入
       ├─ 创建临时文件路径
       ├─ 写入临时文件
       ├─ 验证写入成功
       ├─ 原子性 rename 到目标路径
       └─ 失败时清理临时文件

    4. 更新缓存
       ├─ 更新缓存中的 mtime
       └─ 标记缓存为最新

    5. 触发事件
       └─ 触发 config:saved 事件

3. BinaryManager（二进制管理器）
-----------------------------------------------------------------

职责: FRP 二进制文件的下载、安装、版本管理

核心方法:
  - ensureInstalled(version?: string): Promise<string>
  - download(version: string): Promise<void>
  - update(version: string): Promise<void>
  - getInstalledVersion(): string | null
  - getBinaryPath(version?: string): string
  - remove(version: string): Promise<void>

内部机制:

  - platformStrategy: PlatformStrategy
    平台特定操作（解压、权限设置）

  - versionCache: Map<string, string>
    版本号缓存

设计要点:

  ✓ 懒加载下载
    - 只在需要时才下载二进制
    - 支持离线模式

  ✓ 版本隔离
    - 不同版本的二进制分开存储
    - 支持多版本共存

  ✓ 下载恢复
    - 支持断点续传
    - 下载失败自动重试

4. TunnelManager（隧道管理器）
-----------------------------------------------------------------

职责: 隧道（Proxy）配置的增删改查和验证

核心方法:
  - add(proxy: ProxyConfig): Promise<void>
  - get(name: string): ProxyConfig | null
  - update(name: string, proxy: Partial<ProxyConfig>): Promise<void>
  - remove(name: string): Promise<void>
  - list(): ProxyConfig[]
  - exists(name: string): boolean
  - validate(proxy: ProxyConfig): ValidationResult

内部机制:

  - configStore: ConfigurationStore
    用于读写隧道配置

  - validators: Map<ProxyType, ProxyValidator>
    不同类型代理的验证器

设计要点:

  ✓ 唯一性约束
    - 名称唯一性校验
    - 端口冲突检测（针对使用 remotePort 的类型）

  ✓ 批量操作
    - 批量添加/删除
    - 事务支持

  ✓ 兼容性处理
    - 支持遗留格式（独立 section）
    - 支持 [[proxies]] 数组格式

5. NodeManager（节点管理器）
-----------------------------------------------------------------

职责: FRP 服务器节点信息的管理（Client 模式）

核心方法:
  - setNode(node: NodeInfo): void
  - getNode(): NodeInfo | null
  - updateNode(updates: Partial<NodeInfo>): void
  - clearNode(): void
  - validateNode(node: NodeInfo): ValidationResult

设计要点:

  ✓ 与隧道管理分离
    - 节点信息独立于隧道配置
    - serverAddr/serverPort/auth 独立管理

  ✓ 配置合并
    - 节点信息与隧道配置在写入时合并

6. BackupService（备份服务）
-----------------------------------------------------------------

职责: 配置文件的备份和恢复

核心方法:
  - backup(path: string): Promise<string>
  - restore(backupPath: string): Promise<void>
  - listBackups(path: string): BackupInfo[]
  - cleanup(olderThan: Date): Promise<void>

7. VersionService（版本服务）
-----------------------------------------------------------------

职责: FRP 版本信息的获取和管理

核心方法:
  - getLatest(): Promise<string>
  - getAllVersions(): Promise<string[]>
  - checkUpdate(): Promise<{ current: string, latest: string }>

五、新 API 设计对比
=================================================================

| 旧 API | 新 API | 变化说明 |
|--------|--------|----------|
| `processManager.start()` | `orchestrator.start()` | 统一入口 |
| `processManager.stop()` | `orchestrator.stop()` | 统一入口 |
| `processManager.isRunning()` | `orchestrator.isRunning()` | 统一入口 |
| `processManager.queryProcess()` | `orchestrator.getProcessStatus()` | 更语义化 |
| `processManager.addTunnel()` | `orchestrator.tunnels.add()` | 分组管理 |
| `processManager.getTunnel()` | `orchestrator.tunnels.get()` | 分组管理 |
| `processManager.updateTunnel()` | `orchestrator.tunnels.update()` | 分组管理 |
| `processManager.removeTunnel()` | `orchestrator.tunnels.remove()` | 分组管理 |
| `processManager.listTunnels()` | `orchestrator.tunnels.list()` | 分组管理 |
| `processManager.addNode()` | `orchestrator.node.set()` | 更语义化 |
| `processManager.getNode()` | `orchestrator.node.get()` | 更语义化 |
| `processManager.updateNode()` | `orchestrator.node.update()` | 更语义化 |
| `processManager.removeNode()` | `orchestrator.node.clear()` | 更语义化 |
| `processManager.getConfig()` | `orchestrator.config.get()` | 分组管理 |
| `processManager.updateConfig()` | `orchestrator.config.set()` | 分组管理 |
| `processManager.downloadFrpBinary()` | `orchestrator.binary.ensure()` | 更语义化 |

六、frp-web 项目改动点
=================================================================

当前 frp-web 对 frp-bridge 的使用方式分析:

```typescript
// frp-web/server/bridge/index.ts
const bridge = new FrpBridge({
  mode,
  workDir,
  process: { mode, workDir, version, configPath },
  commands: { /* 自定义命令 */ },
  eventSink: event => eventBus.emit('frp-event', event)
})

// 获取 ProcessManager
const processManager = bridge.getProcessManager()

// 直接调用的方法
processManager.start()
processManager.stop()
processManager.isRunning()
processManager.queryProcess()
processManager.listTunnels()

// 通过命令系统调用
await bridge.execute({ name: 'proxy.add', payload: { proxy } })
await bridge.execute({ name: 'proxy.update', payload: { name, proxy } })
await bridge.execute({ name: 'proxy.remove', payload: { name } })
await bridge.query({ name: 'proxy.list' })
```

需要修改的文件清单:

1. **server/bridge/index.ts** (主要入口)
   - 路径: `D:/Projects/frp-web/server/bridge/index.ts`
   - 变更:
     ```typescript
     // 旧代码
     const processManager = bridge.getProcessManager()
     const tunnels = processManager.listTunnels()

     // 新代码
     const tunnels = await bridge.query({ name: 'tunnel.list' })
     ```

2. **server/utils/bridge.ts** (工具函数)
   - 路径: `D:/Projects/frp-web/server/utils/bridge.ts`
   - 变更:
     ```typescript
     // 旧代码
     const processManager = bridge.getProcessManager()
     const tunnels = processManager.listTunnels()

     // 新代码
     const queryResult = await bridge.query({ name: 'tunnel.list' })
     const tunnels = queryResult.result ?? []
     ```

3. **server/api/commands/start.post.ts**
   - 路径: `D:/Projects/frp-web/server/api/commands/start.post.ts`
   - 变更:
     ```typescript
     // 旧代码
     const processManager = bridge.getProcessManager()
     if (processManager.isRunning()) {
      // ...
    }
     await processManager.start()
     const processInfo = processManager.queryProcess()

     // 新代码
     const statusResult = await bridge.query({ name: 'process.status' })
     if (statusResult.result?.running) {
      // ...
    }
     await bridge.execute({ name: 'process.start' })
     const newStatusResult = await bridge.query({ name: 'process.status' })
     ```

4. **server/api/commands/stop.post.ts**
   - 路径: `D:/Projects/frp-web/server/api/commands/stop.post.ts`
   - 变更:
     ```typescript
     // 旧代码
     const processManager = bridge.getProcessManager()
     if (!processManager.isRunning()) {
      // ...
    }
     await processManager.stop()

     // 新代码
     const statusResult = await bridge.query({ name: 'process.status' })
     if (!statusResult.result?.running) {
      // ...
    }
     await bridge.execute({ name: 'process.stop' })
     ```

5. **server/api/commands/restart.post.ts**
   - 路径: `D:/Projects/frp-web/server/api/commands/restart.post.ts`
   - 变更:
     ```typescript
     // 旧代码
     const wasRunning = processManager.isRunning()
     if (wasRunning)
       await processManager.stop()
     await processManager.start()

     // 新代码
     const statusResult = await bridge.query({ name: 'process.status' })
     const wasRunning = statusResult.result?.running ?? false
     if (wasRunning)
       await bridge.execute({ name: 'process.stop' })
     await bridge.execute({ name: 'process.start' })
     ```

6. **server/api/status/events.get.ts**
   - 路径: `D:/Projects/frp-web/server/api/status/events.get.ts`
   - 变更:
     ```typescript
     // 旧代码
     const processManager = bridge.getProcessManager()
     const isRunning = processManager.isRunning()
     const processInfo = processManager.queryProcess()

     // 新代码
     const statusResult = await bridge.query({ name: 'process.status' })
     const isRunning = statusResult.result?.running ?? false
     const processInfo = statusResult.result ?? {}
     ```

7. **server/api/config/tunnel.get.ts**
   - 路径: `D:/Projects/frp-web/server/api/config/tunnel.get.ts`
   - 当前使用: `bridge.query({ name: 'proxy.list' })`
   - 变更为: `bridge.query({ name: 'tunnel.list' })`
   - 命名保持一致，仅修改命令名称

8. **server/api/config/tunnel.post.ts**
   - 路径: `D:/Projects/frp-web/server/api/config/tunnel.post.ts`
   - 当前使用: `bridge.execute({ name: 'proxy.add', payload })`
   - 变更为: `bridge.execute({ name: 'tunnel.add', payload })`

9. **server/api/config/tunnel.put.ts**
   - 路径: `D:/Projects/frp-web/server/api/config/tunnel.put.ts`
   - 当前使用: `bridge.execute({ name: 'proxy.update', payload })`
   - 变更为: `bridge.execute({ name: 'tunnel.update', payload })`

10. **server/api/config/tunnel.delete.ts**
    - 路径: `D:/Projects/frp-web/server/api/config/tunnel.delete.ts`
    - 当前使用: `bridge.execute({ name: 'proxy.remove', payload })`
    - 变更为: `bridge.execute({ name: 'tunnel.remove', payload })`

新的命令/查询 API 设计:

```typescript
// 进程相关
bridge.execute({ name: 'process.start' })
bridge.execute({ name: 'process.stop' })
bridge.execute({ name: 'process.restart' })
bridge.query({ name: 'process.status' })
// 返回: { running: boolean, pid?: number, uptime?: number }

// 隧道相关
// bridge.execute({ name: 'tunnel.add', payload: { proxy: ProxyConfig } })
// bridge.execute({ name: 'tunnel.update', payload: { name, proxy: Partial<ProxyConfig> } })
// bridge.execute({ name: 'tunnel.remove', payload: { name } })
bridge.query({ name: 'tunnel.list' })
// bridge.query({ name: 'tunnel.get', payload: { name } })

// 节点相关 (Client 模式)
// bridge.execute({ name: 'node.set', payload: { node: NodeInfo } })
// bridge.execute({ name: 'node.update', payload: { updates: Partial<NodeInfo> } })
bridge.execute({ name: 'node.clear' })
bridge.query({ name: 'node.get' })

// 配置相关
bridge.query({ name: 'config.get' })
// bridge.execute({ name: 'config.set', payload: { config: Partial<FrpConfig> } })
// bridge.execute({ name: 'config.applyRaw', payload: { content, restart?: boolean } })

// 二进制相关
// bridge.execute({ name: 'binary.download', payload: { version?: string } })
// bridge.execute({ name: 'binary.update', payload: { version: string } })
bridge.query({ name: 'binary.version' })
```

迁移步骤建议:

1. **第一阶段**: 在 frp-bridge 中实现新的组件架构
   - 创建 ProcessController
   - 创建 ConfigurationStore
   - 创建 TunnelManager
   - 创建 NodeManager
   - 创建 BinaryManager

2. **第二阶段**: 更新 FrpBridge 类，使用新组件
   - 替换内部的 FrpProcessManager 为新组件组合
   - 更新命令处理器以使用新组件

3. **第三阶段**: 修改 frp-web 项目
   - 按文件清单逐个修改
   - 更新 API 调用方式
   - 测试验证

4. **第四阶段**: 清理
   - 删除旧的 FrpProcessManager 类
   - 更新导出
   - 更新文档

七、实施优先级
=================================================================

P0 - 核心功能（必须实现）:
- ProcessController
- ConfigurationStore
- TunnelManager
- NodeManager

P1 - 增强功能（建议实现）:
- BinaryManager
- BackupService
- 配置缓存
- 配置热重载

P2 - 可选功能（后续优化）:
- VersionService
- 进程健康检查
- 多进程支持
- 配置 Schema 验证

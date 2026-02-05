# 代码优化路线图

本文档记录了 frp-bridge 项目中识别出的优化点，按优先级和类别组织。

## 目录

- [优化概览](#优化概览)
- [第一阶段：高优先级优化](#第一阶段高优先级优化)
- [第二阶段：中优先级优化](#第二阶段中优先级优化)
- [第三阶段：低优先级优化](#第三阶段低优先级优化)
- [设计模式应用总结](#设计模式应用总结)

---

## 优化概览

### 当前代码问题总结

通过对整个项目的全面梳理，识别出以下主要问题：

1. **代码重复**：TOML 处理、配置合并等逻辑在多处重复实现
2. **职责过重**：`FrpProcessManager` 类达到 673 行，承担过多职责
3. **类型安全不足**：大量 `as` 断言、字符串类型用于消息类型
4. **可测试性差**：硬编码的依赖（文件系统、网络请求）难以 mock
5. **扩展性受限**：缺少中间件机制、插件系统
6. **错误处理不统一**：自定义错误类和普通错误对象混用

### 优化统计

| 优化项 | 数量 | 涉及文件数 |
|--------|------|-----------|
| 重复代码消除 | 8+ | 12 |
| 设计模式应用 | 12 | 20 |
| 类型安全增强 | 15+ | 25 |
| 可测试性改进 | 10 | 15 |

---

## 第一阶段：高优先级优化

### 1. TOML 处理统一化

**优先级**: ⭐⭐⭐⭐⭐
**影响范围**: 全局
**复杂度**: 中等

#### 当前问题

在以下文件中存在重复的 TOML 处理逻辑：
- [packages/core/src/utils/index.ts](../packages/core/src/utils/index.ts:148-281) - `parseToml`, `toToml`
- [packages/frp-bridge/src/config-merger.ts](../packages/frp-bridge/src/config-merger.ts:117-206) - `tunnelsToToml`, `configToToml`

**重复代码量**: ~200 行

#### 优化方案

**方案一：使用成熟 TOML 库**
```typescript
// packages/core/src/toml/index.ts
import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml'

export function parse(content: string): Record<string, any> {
  return parseToml(content)
}

export function generate(obj: Record<string, any>): string {
  return stringifyToml(obj)
}
```

**方案二：策略模式（如需自定义处理）**
```typescript
// packages/core/src/toml/toml-parser.ts
export interface TomlParser {
  parse: (content: string) => Record<string, any>
}

export interface TomlGenerator {
  generate: (obj: Record<string, any>) => string
}

export class IarnaTomlAdapter implements TomlParser, TomlGenerator {
  parse(content: string) { /* 使用 @iarna/toml */ }
  generate(obj: Record<string, any>) { /* 使用 @iarna/toml */ }
}
```

#### 收益

- 消除 ~200 行重复代码
- 获得更强大的 TOML 解析能力
- 统一的错误处理
- 更好的类型推导

#### 实施步骤

1. 安装 `@iarna/toml` 或 `smol-toml`
2. 创建 `packages/core/src/toml/index.ts`
3. 替换所有使用 `parseToml` 和 `toToml` 的地方
4. 添加单元测试

---

### 2. 进程管理拆分 - 单一职责原则

**优先级**: ⭐⭐⭐⭐⭐
**影响范围**: 进程管理模块
**复杂度**: 高

#### 当前问题

[FrpProcessManager](../packages/core/src/process/index.ts:61-673) 类承担了以下职责：
1. 进程生命周期管理（启动、停止、重启）
2. 配置文件读写
3. Tunnel/Proxy 管理
4. 二进制下载和管理
5. Node 管理（客户端模式）
6. 平台特定的解压和权限处理

**代码行数**: 673 行
**方法数**: 30+

#### 优化方案

**拆分 1: Platform Strategy（平台策略）**
```typescript
// packages/core/src/process/platform/platform-strategy.ts
export interface PlatformStrategy {
  extractArchive: (archivePath: string, targetDir: string) => Promise<void>
  setExecutable: (path: string) => void
  getArchiveExtension: () => string
}

export class WindowsPlatformStrategy implements PlatformStrategy {
  extractArchive(archivePath: string, targetDir: string): Promise<void> {
    const hasUnzip = await commandExists('unzip')
    if (!hasUnzip) {
      throw new FrpBridgeError('unzip is required', ErrorCode.EXTRACTION_FAILED)
    }
    await executeCommand(`unzip -o "${archivePath}" -d "${targetDir}"`)
  }

  setExecutable(path: string): void {
    // No-op on Windows
  }

  getArchiveExtension(): string {
    return 'zip'
  }
}

export class UnixPlatformStrategy implements PlatformStrategy {
  extractArchive(archivePath: string, targetDir: string): Promise<void> {
    const hasGzip = await commandExists('gzip')
    const hasTar = await commandExists('tar')
    if (!hasGzip || !hasTar) {
      throw new FrpBridgeError('gzip and tar are required', ErrorCode.EXTRACTION_FAILED)
    }
    await executeCommand(`tar -xzf "${archivePath}" -C "${targetDir}"`)
  }

  setExecutable(path: string): void {
    chmodSync(path, 0o755)
  }

  getArchiveExtension(): string {
    return 'tar.gz'
  }
}

// 使用工厂创建
export class PlatformStrategyFactory {
  static create(): PlatformStrategy {
    return process.platform === 'win32'
      ? new WindowsPlatformStrategy()
      : new UnixPlatformStrategy()
  }
}
```

**拆分 2: Tunnel Manager（隧道管理）**
```typescript
// packages/core/src/process/tunnel-manager.ts
export class TunnelManager {
  constructor(
    private configPath: string,
    private logger?: RuntimeLogger
  ) {}

  add(tunnel: ProxyConfig): void {
    const content = existsSync(this.configPath)
      ? readFileSync(this.configPath, 'utf-8')
      : ''
    const parsed = content ? parseToml(content) : {}

    if (!Array.isArray(parsed.proxies)) {
      parsed.proxies = []
    }

    this.validateTunnel(tunnel, parsed.proxies)

    parsed.proxies.push(tunnel)

    const newContent = toToml(parsed)
    writeFileSync(this.configPath, newContent, 'utf-8')
  }

  get(name: string): ProxyConfig | null {
    if (!existsSync(this.configPath))
      return null

    const content = readFileSync(this.configPath, 'utf-8')
    const parsed = parseToml(content)

    if (Array.isArray(parsed.proxies)) {
      return parsed.proxies.find((p: any) => p?.name === name) || null
    }
    return null
  }

  update(name: string, tunnel: Partial<ProxyConfig>): void { /* ... */ }
  remove(name: string): void { /* ... */ }
  list(): ProxyConfig[] { /* ... */ }

  private validateTunnel(tunnel: ProxyConfig, existing: ProxyConfig[]): void {
    // 检查名称冲突
    const existingIndex = existing.findIndex(p => p?.name === tunnel.name)
    if (existingIndex !== -1) {
      throw new FrpBridgeError(`Tunnel ${tunnel.name} already exists`, ErrorCode.CONFIG_INVALID)
    }

    // 检查端口冲突
    const proxyRemotePort = (tunnel as any).remotePort
    if (proxyRemotePort && this.typeUsesRemotePort(tunnel.type)) {
      const remotePortInUse = existing.some((p) => {
        const pRemotePort = (p as any).remotePort
        return p && pRemotePort === proxyRemotePort && this.typeUsesRemotePort(p.type)
      })
      if (remotePortInUse) {
        throw new FrpBridgeError(`Remote port ${proxyRemotePort} is already in use`, ErrorCode.CONFIG_INVALID)
      }
    }
  }

  private typeUsesRemotePort(type: string): boolean {
    return ['tcp', 'udp', 'stcp', 'xtcp', 'sudp', 'tcpmux'].includes(type)
  }
}
```

**拆分 3: Binary Manager（二进制管理）**
```typescript
// packages/core/src/process/binary-manager.ts
export class BinaryManager {
  constructor(
    private workDir: string,
    private version: string | null,
    private platformStrategy: PlatformStrategy,
    private logger?: RuntimeLogger
  ) {}

  async download(): Promise<void> {
    const platform = getPlatform()
    const url = getDownloadUrl(this.version!, platform)
    const archiveExt = this.platformStrategy.getArchiveExtension()
    const archivePath = join(this.workDir, `frp_${this.version}.${archiveExt}`)
    const binDir = join(this.workDir, 'bin', this.version!)

    ensureDir(binDir)

    await downloadFile(url, archivePath)

    const extractDir = join(this.workDir, 'temp')
    ensureDir(extractDir)

    await this.platformStrategy.extractArchive(archivePath, extractDir)

    // Move binary to destination
    await this.moveBinary(extractDir, binDir)

    // Cleanup
    const fs = await import('fs-extra')
    await fs.remove(archivePath)
    await fs.remove(extractDir)
  }

  async update(newVersion?: string): Promise<void> { /* ... */ }
  hasBinary(): boolean { /* ... */ }

  private async moveBinary(extractDir: string, binDir: string): Promise<void> { /* ... */ }
}
```

**重构后的 FrpProcessManager**
```typescript
// packages/core/src/process/index.ts
export class FrpProcessManager extends EventEmitter {
  private readonly tunnelManager: TunnelManager
  private readonly binaryManager: BinaryManager
  private process: ChildProcess | null = null

  constructor(options: FrpProcessManagerOptions) {
    super()
    this.mode = options.mode
    this.workDir = options.workDir || join(homedir(), '.frp-bridge')
    this.configPath = options.configPath || join(this.workDir, `frp${this.mode === 'client' ? 'c' : 's'}.toml`)
    this.logger = options.logger ?? consola.withTag('FrpProcessManager')

    const platformStrategy = PlatformStrategyFactory.create()
    this.binaryManager = new BinaryManager(this.workDir, options.version, platformStrategy, this.logger)
    this.tunnelManager = new TunnelManager(this.configPath, this.logger)

    ensureDir(this.workDir)
  }

  // 简化的接口 - 委托给专门的管理器
  async downloadFrpBinary(): Promise<void> {
    await this.binaryManager.download()
  }

  addTunnel(proxy: ProxyConfig): void {
    this.tunnelManager.add(proxy)
  }

  getTunnel(name: string): ProxyConfig | null {
    return this.tunnelManager.get(name)
  }

  updateTunnel(name: string, proxy: Partial<ProxyConfig>): void {
    this.tunnelManager.update(name, proxy)
  }

  removeTunnel(name: string): void {
    this.tunnelManager.remove(name)
  }

  listTunnels(): ProxyConfig[] {
    return this.tunnelManager.list()
  }

  // 保留核心进程管理方法
  async start(): Promise<void> { /* ... */ }
  async stop(): Promise<void> { /* ... */ }
  isRunning(): boolean { /* ... */ }
}
```

#### 收益

- **FrpProcessManager** 从 673 行减少到 ~150 行
- 每个类职责单一，易于测试
- 平台相关逻辑独立，易于扩展新平台
- 隧道管理逻辑可复用

#### 实施步骤

1. 创建 `platform-strategy.ts`
2. 提取 `TunnelManager` 类
3. 提取 `BinaryManager` 类
4. 重构 `FrpProcessManager` 使用新的管理器
5. 更新单元测试

---

### 3. 错误处理统一化

**优先级**: ⭐⭐⭐⭐
**影响范围**: 全局
**复杂度**: 中等

#### 当前问题

项目中混用两种错误类型：
1. 自定义 `FrpBridgeError` 类（在 [errors/index.ts](../packages/core/src/errors/index.ts:1-27)）
2. 普通错误对象 `{ code, message, details }`（在 command handlers 中）

**类型不统一导致**：
- 难以集中处理错误
- 错误信息不一致
- 无法利用 instanceof 进行类型判断

#### 优化方案

**建立错误层次结构**
```typescript
// packages/core/src/errors/base-error.ts
export abstract class FrpBridgeErrorBase extends Error {
  abstract readonly code: string
  abstract readonly statusCode?: number
  readonly details?: Record<string, unknown>
  readonly timestamp = Date.now()

  constructor(message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = this.constructor.name
    this.details = details
    Error.captureStackTrace(this, this.constructor)
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp
    }
  }
}

// packages/core/src/errors/validation-error.ts
export class ValidationError extends FrpBridgeErrorBase {
  readonly code = 'VALIDATION_ERROR' as const
  readonly statusCode = 400

  constructor(
    message: string,
    public readonly field?: string,
    details?: Record<string, unknown>
  ) {
    super(message, details)
  }
}

// packages/core/src/errors/port-conflict-error.ts
export class PortConflictError extends ValidationError {
  readonly code = 'PORT_CONFLICT' as const

  constructor(
    port: number,
    public readonly occupiedBy: { nodeId: string, tunnelName: string }
  ) {
    super(
      `Port ${port} is already in use by tunnel "${occupiedBy.tunnelName}" on node ${occupiedBy.nodeId}`,
      'remotePort',
      { port, occupiedBy }
    )
  }
}

// packages/core/src/errors/error-handler.ts
export class ErrorHandler {
  static toResult(error: unknown): CommandResult {
    if (error instanceof FrpBridgeErrorBase) {
      return {
        status: 'failed',
        error: error.toJSON()
      }
    }

    if (error instanceof Error) {
      return {
        status: 'failed',
        error: {
          code: 'SYSTEM_ERROR',
          message: error.message,
          details: { stack: error.stack }
        }
      }
    }

    return {
      status: 'failed',
      error: {
        code: 'UNKNOWN_ERROR',
        message: 'An unknown error occurred'
      }
    }
  }

  static async wrap<T>(
    fn: () => Promise<T>
  ): Promise<CommandResult<T>> {
    try {
      const result = await fn()
      return { status: 'success', result }
    }
    catch (error) {
      return this.toResult(error)
    }
  }
}
```

**在 Command Handlers 中使用**
```typescript
// packages/core/src/bridge/handlers/command-handlers.ts
export class ProxyAddHandler {
  async handle(command: Command<ProxyAddPayload>): Promise<CommandResult> {
    return ErrorHandler.wrap(async () => {
      const { proxy } = command.payload

      // 验证
      if (!proxy.name) {
        throw new ValidationError('Proxy name is required', 'name')
      }

      // 业务逻辑
      this.process.addTunnel(proxy)

      return proxy
    })
  }
}
```

#### 收益

- 统一的错误类型系统
- 自动生成错误时间戳
- 便于错误监控和日志
- 支持类型守卫 (`error instanceof ValidationError`)

#### 实施步骤

1. 创建 `base-error.ts`
2. 创建具体的错误类
3. 创建 `ErrorHandler`
4. 更新所有 command handlers
5. 添加错误处理单元测试

---

## 第二阶段：中优先级优化

### 4. 配置管理 - 策略模式

**优先级**: ⭐⭐⭐⭐
**影响范围**: 配置管理模块
**复杂度**: 中等

#### 当前问题

在 [config-merger.ts](../packages/frp-bridge/src/config-merger.ts:18-83) 中：
- frps 和 frpc 的合并逻辑硬编码在一个函数中
- 大量类型断言 `as FrpsPresetConfig`
- 重复的字符串拼接逻辑

#### 优化方案

```typescript
// packages/frp-bridge/src/config/strategies.ts
export interface ConfigMergeStrategy {
  merge: (preset: any, userConfig: string) => string
  validate?: (config: any) => ValidationResult
}

export class FrpsConfigStrategy implements ConfigMergeStrategy {
  merge(preset: FrpsPresetConfig, userConfig: string): string {
    const builder = new TomlBuilder()

    // 添加基础配置
    if (preset.bindPort) {
      builder.addKeyValue('bindPort', preset.bindPort)
    }
    if (preset.vhostHTTPPort) {
      builder.addKeyValue('vhostHTTPPort', preset.vhostHTTPPort)
    }

    // 添加 Dashboard 配置
    if (preset.dashboardPort) {
      builder
        .addSection('webServer')
        .addKeyValue('addr', '0.0.0.0')
        .addKeyValue('port', preset.dashboardPort)

      if (preset.dashboardUser) {
        builder.addKeyValue('user', preset.dashboardUser)
      }
      if (preset.dashboardPassword) {
        builder.addKeyValue('password', preset.dashboardPassword)
      }
    }

    // 提取并添加用户配置中的代理部分
    const proxiesSection = this.extractProxiesSection(userConfig)
    if (proxiesSection) {
      builder.addRaw(proxiesSection)
    }

    return builder.build()
  }

  private extractProxiesSection(userConfig: string): string { /* ... */ }
}

export class FrpcConfigStrategy implements ConfigMergeStrategy {
  merge(preset: FrpcPresetConfig, userConfig: string): string {
    const builder = new TomlBuilder()

    // 添加服务器配置
    if (preset.serverAddr) {
      builder.addKeyValue('serverAddr', preset.serverAddr)
    }
    if (preset.serverPort) {
      builder.addKeyValue('serverPort', preset.serverPort)
    }
    if (preset.authToken) {
      builder.addKeyValue('auth.token', preset.authToken)
    }

    // 添加用户代理配置
    const proxiesSection = this.extractProxiesSection(userConfig)
    if (proxiesSection) {
      builder.addRaw(proxiesSection)
    }

    return builder.build()
  }

  private extractProxiesSection(userConfig: string): string { /* ... */ }
}

// packages/frp-bridge/src/config/config-merger.ts
export class ConfigMerger {
  private strategies = new Map<'frps' | 'frpc', ConfigMergeStrategy>()

  constructor() {
    this.registerStrategy('frps', new FrpsConfigStrategy())
    this.registerStrategy('frpc', new FrpcConfigStrategy())
  }

  registerStrategy(type: 'frps' | 'frpc', strategy: ConfigMergeStrategy): void {
    this.strategies.set(type, strategy)
  }

  merge(type: 'frps' | 'frpc', preset: PresetConfig, userConfig: string): string {
    const strategy = this.strategies.get(type)
    if (!strategy) {
      throw new Error(`No strategy registered for type: ${type}`)
    }

    const typeConfig = preset[type]
    if (!typeConfig) {
      return userConfig
    }

    return strategy.merge(typeConfig, userConfig)
  }
}
```

**TOML Builder（Builder Pattern）**
```typescript
// packages/frp-bridge/src/config/toml-builder.ts
export class TomlBuilder {
  private lines: string[] = []

  addKeyValue(key: string, value: string | number | boolean): this {
    this.lines.push(`${key} = ${this.formatValue(value)}`)
    return this
  }

  addSection(name: string): this {
    this.lines.push('')
    this.lines.push(`[${name}]`)
    return this
  }

  addArraySection(name: string): this {
    this.lines.push('')
    this.lines.push(`[[${name}]]`)
    return this
  }

  addRaw(text: string): this {
    this.lines.push(text)
    return this
  }

  build(): string {
    return this.lines.join('\n').trim()
  }

  private formatValue(value: any): string {
    if (typeof value === 'string') {
      return `"${value}"`
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      return String(value)
    }
    return `"${String(value)}"`
  }
}
```

#### 收益

- 配置生成逻辑类型安全
- 易于扩展新的配置类型
- 消除重复代码
- 更清晰的配置生成流程

---

### 5. RPC 通信 - 中间件模式

**优先级**: ⭐⭐⭐⭐
**影响范围**: RPC 模块
**复杂度**: 中等

#### 当前问题

在 [rpc-server.ts](../packages/core/src/rpc/rpc-server.ts:26-176) 中：
- 消息类型使用字符串字面量 (`msg.type === 'register'`)
- 缺少日志、认证等横切关注点的机制
- 重连逻辑简单（固定间隔）

#### 优化方案

**消息类型枚举 + 类型守卫**
```typescript
// packages/core/src/rpc/message-types.ts
export enum RpcMessageType {
  REGISTER = 'register',
  COMMAND = 'command',
  RESPONSE = 'response',
  PING = 'ping',
  PONG = 'pong'
}

export interface RegisterMessage {
  type: RpcMessageType.REGISTER
  nodeId: string
  payload: NodeInfo
}

export interface RpcRequest {
  id: string
  method: string
  params: Record<string, unknown>
  timeout?: number
}

export interface RpcResponse {
  id: string
  status: 'success' | 'error'
  result?: unknown
  error?: { code: string, message: string }
}

export type RpcMessage = RegisterMessage | RpcRequest | RpcResponse | { type: RpcMessageType.PING | RpcMessageType.PONG }

// 类型守卫
export function isRegisterMessage(msg: any): msg is RegisterMessage {
  return msg?.type === RpcMessageType.REGISTER
}

export function isRpcRequest(msg: any): msg is RpcRequest {
  return msg?.method && msg?.id
}

export function isRpcResponse(msg: any): msg is RpcResponse {
  return msg?.id && msg?.status
}
```

**中间件系统**
```typescript
// packages/core/src/rpc/middleware.ts
export type MiddlewareFn = (
  req: RpcRequest,
  res: Partial<RpcResponse>,
  next: () => Promise<void>
) => Promise<void>

export class RpcServer {
  private middlewares: MiddlewareFn[] = []
  private handlers = new Map<string, (req: RpcRequest) => Promise<any>>()

  use(middleware: MiddlewareFn): this {
    this.middlewares.push(middleware)
    return this
  }

  register(method: string, handler: (req: RpcRequest) => Promise<any>): void {
    this.handlers.set(method, handler)
  }

  private async handleRequest(req: RpcRequest): Promise<RpcResponse> {
    const res: Partial<RpcResponse> = { id: req.id }

    try {
      // 构建中间件链
      const chain = this.middlewares.reduceRight(
        (next, middleware) => () => middleware(req, res, next),
        () => this.executeHandler(req)
      )

      await chain()

      return {
        id: req.id,
        status: 'success',
        result: res.result
      }
    }
    catch (error) {
      return {
        id: req.id,
        status: 'error',
        error: {
          code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    }
  }

  private async executeHandler(req: RpcRequest): Promise<void> {
    const handler = this.handlers.get(req.method)
    if (!handler) {
      throw new Error(`Unknown method: ${req.method}`)
    }
    return handler(req)
  }
}

// 预定义中间件
export function loggingMiddleware(logger?: RuntimeLogger): MiddlewareFn {
  return async (req, res, next) => {
    const start = Date.now()
    logger?.info?.('RPC request', { method: req.method, params: req.params })
    await next()
    logger?.info?.('RPC response', {
      method: req.method,
      duration: Date.now() - start,
      status: res.status
    })
  }
}

export function authMiddleware(validateToken: (token: string) => Promise<boolean>): MiddlewareFn {
  return async (req, res, next) => {
    const token = req.params.token as string | undefined
    if (!token || !(await validateToken(token))) {
      res.status = 'error'
      res.error = { code: 'UNAUTHORIZED', message: 'Invalid or missing token' }
      return
    }
    await next()
  }
}
```

**指数退避重连**
```typescript
// packages/core/src/rpc/reconnect-strategy.ts
export interface ReconnectStrategy {
  shouldReconnect: (attempt: number) => boolean
  getDelay: (attempt: number) => number
  onMaxAttemptsReached: () => void
}

export class ExponentialBackoffStrategy implements ReconnectStrategy {
  constructor(
    private maxAttempts = 10,
    private baseDelay = 1000,
    private maxDelay = 30000
  ) {}

  shouldReconnect(attempt: number): boolean {
    return attempt < this.maxAttempts
  }

  getDelay(attempt: number): number {
    return Math.min(
      this.baseDelay * 2 ** attempt,
      this.maxDelay
    )
  }

  onMaxAttemptsReached(): void {
    console.error('Max reconnection attempts reached')
  }
}

// 在 RpcClient 中使用
export class RpcClient {
  constructor(
    private options: RpcClientOptions,
    private reconnectStrategy: ReconnectStrategy = new ExponentialBackoffStrategy()
  ) {}

  private scheduleReconnect(attempt = 0): void {
    if (!this.reconnectStrategy.shouldReconnect(attempt)) {
      this.reconnectStrategy.onMaxAttemptsReached()
      return
    }

    const delay = this.reconnectStrategy.getDelay(attempt)
    this.reconnectTimer = setTimeout(() => {
      this.createConnection().catch(() => {
        this.scheduleReconnect(attempt + 1)
      })
    }, delay)
  }
}
```

#### 收益

- 类型安全的消息处理
- 可插拔的中间件系统
- 智能重连机制
- 更易于测试和扩展

---

### 6. 命令处理器 - 装饰器模式 ✅ 已完成

**优先级**: ⭐⭐⭐
**影响范围**: Command Handlers
**复杂度**: 中等
**状态**: ✅ 已完成

#### 当前问题

在 [command-handlers.ts](../packages/core/src/bridge/handlers/command-handlers.ts:288-375) 中：
- Server/Client 模式判断逻辑在多个 handler 中重复
- 验证逻辑模板化
- 错误处理代码重复

#### 实施方案

```typescript
// packages/core/src/bridge/handlers/decorators.ts
export type HandlerDecorator<T = any> = (
  handler: CommandHandler<T>,
  deps: CommandDependencies
) => CommandHandler<T>

export function withServerModeOnly<T>(
  handler: CommandHandler<T>,
  deps: CommandDependencies
): CommandHandler<T> {
  return async (command, ctx) => {
    if (deps.mode !== 'server') {
      return {
        status: 'failed',
        error: {
          code: 'MODE_ERROR',
          message: 'This operation is only available in server mode'
        }
      }
    }
    return handler(command, ctx)
  }
}

export function withValidation<T>(
  validator: (payload: T) => ValidationResult,
  handler: CommandHandler<T>
): CommandHandler<T> {
  return async (command, ctx) => {
    const result = validator(command.payload as T)
    if (!result.valid) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: result.error || 'Validation failed'
        }
      }
    }
    return handler(command, ctx)
  }
}

export function withErrorHandling<T>(
  handler: CommandHandler<T>
): CommandHandler<T> {
  return async (command, ctx) => {
    try {
      return await handler(command, ctx)
    }
    catch (error) {
      return ErrorHandler.toResult(error)
    }
  }
}

export function compose<T>(
  ...decorators: HandlerDecorator<T>[]
): (handler: CommandHandler<T>, deps: CommandDependencies) => CommandHandler<T> {
  return (handler, deps) =>
    decorators.reduceRight(
      (h, decorator) => decorator(h, deps),
      handler
    )
}

// 使用示例
function validateProxyAdd(payload: ProxyAddPayload): ValidationResult {
  if (!payload.proxy) {
    return { valid: false, error: 'proxy is required' }
  }
  if (!payload.proxy.name) {
    return { valid: false, error: 'proxy.name is required' }
  }
  return { valid: true }
}

export function createProxyAddCommand(deps: CommandDependencies) {
  return compose<ProxyAddPayload>(
    withErrorHandling,
    withServerModeOnly,
    withValidation(validateProxyAdd)
  )(
    // 实际业务逻辑
    async (command, ctx) => {
      const { proxy, nodeId } = command.payload

      if (deps.mode === 'server') {
        const result = await deps.rpcServer.rpcCall(nodeId, 'proxy.add', { proxy })
        return { status: 'success', result }
      }
      else {
        deps.process.addTunnel(proxy)
        return { status: 'success', result: proxy }
      }
    },
    deps
  )
}
```

#### 收益

- 消除重复的模式检查代码
- 统一的验证和错误处理
- 更清晰的业务逻辑
- 易于添加新的横切关注点

#### 实施结果

**已创建文件**:
- [decorators.ts](../packages/core/src/bridge/handlers/decorators.ts) - 装饰器函数和预设组合

**已重构**:
- 配置命令 (config.apply, config.applyRaw)
- 节点命令 (node.register, node.heartbeat, node.unregister)
- 代理命令 (proxy.add, proxy.update, proxy.remove)

**提供的装饰器**:
- `withErrorHandling` - 统一错误处理
- `withServerModeOnly` / `withClientModeOnly` - 模式限制
- `withNodeManager` / `withRpcServer` - 依赖检查
- `withValidation` - 请求验证
- `withPortConflictCheck` - 端口冲突检查
- `withModeRouting` - Server/Client 模式路由
- `compose` - 装饰器组合
- `presets` - 预构建装饰器组合

---

## 第三阶段：低优先级优化

### 7. 依赖注入容器

**优先级**: ⭐⭐⭐
**影响范围**: 全局
**复杂度**: 中等

#### 优化方案

```typescript
// packages/core/src/di/container.ts
export interface ServiceDescriptor {
  factory: (container: Container) => any
  singleton?: boolean
}

export class Container {
  private services = new Map<string, ServiceDescriptor>()
  private instances = new Map<string, any>()

  register(name: string, descriptor: ServiceDescriptor): void {
    this.services.set(name, descriptor)
  }

  registerSingleton<T>(name: string, factory: (c: Container) => T): void {
    this.register(name, { factory, singleton: true })
  }

  registerTransient<T>(name: string, factory: (c: Container) => T): void {
    this.register(name, { factory, singleton: false })
  }

  resolve<T>(name: string): T {
    const descriptor = this.services.get(name)
    if (!descriptor) {
      throw new Error(`Service '${name}' not registered`)
    }

    if (descriptor.singleton) {
      if (!this.instances.has(name)) {
        this.instances.set(name, descriptor.factory(this))
      }
      return this.instances.get(name)
    }

    return descriptor.factory(this)
  }
}

// 使用示例
const container = new Container()

container.registerSingleton('logger', () => consola.withTag('FrpBridge'))
container.registerSingleton('storage', c =>
  new FileSnapshotStorage(join(workDir, 'snapshots')))
container.registerTransient('runtime', c =>
  new FrpRuntime(c.resolve('context'), {
    storage: c.resolve('storage')
  }))

const runtime = container.resolve<FrpRuntime>('runtime')
```

#### 收益

- 更好的可测试性（易于 mock 依赖）
- 集中管理依赖关系
- 支持单例和瞬态生命周期

---

### 8. 事件总线增强

**优先级**: ⭐⭐⭐
**影响范围**: Runtime 模块
**复杂度**: 低

#### 优化方案

```typescript
// packages/core/src/events/event-bus.ts
export type EventListener<T = any> = (event: T) => void | Promise<void>

export class EventBus {
  private listeners = new Map<string, Set<EventListener>>()

  on<T = any>(eventType: string, listener: EventListener<T>): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    this.listeners.get(eventType)!.add(listener)

    // 返回取消订阅函数
    return () => this.off(eventType, listener)
  }

  async emit<T = any>(eventType: string, event: T): Promise<void> {
    const listeners = this.listeners.get(eventType)
    if (!listeners)
      return

    const promises = Array.from(listeners).map(listener =>
      Promise.resolve(listener(event))
    )
    await Promise.allSettled(promises)
  }

  private off(eventType: string, listener: EventListener): void {
    this.listeners.get(eventType)?.delete(listener)
  }

  once<T = any>(eventType: string, listener: EventListener<T>): () => void {
    const wrappedListener = (event: T) => {
      listener(event)
      this.off(eventType, wrappedListener as any)
    }
    return this.on(eventType, wrappedListener as any)
  }
}

// 在 FrpRuntime 中使用
export class FrpRuntime {
  private eventBus = new EventBus()

  on<T = any>(eventType: string, listener: EventListener<T>): () => void {
    return this.eventBus.on(eventType, listener)
  }

  emit<T = any>(eventType: string, event: T): Promise<void> {
    return this.eventBus.emit(eventType, {
      ...event,
      timestamp: event.timestamp ?? Date.now()
    })
  }
}

// 使用示例
bridge.runtime.on('process:started', async (event) => {
  logger.info('Process started', { pid: event.payload?.pid })
})

const unsubscribe = bridge.runtime.on('tunnel:added', (event) => {
  console.log('Tunnel added:', event.payload)
})

// 取消订阅
unsubscribe()
```

**事件过滤器**
```typescript
// packages/core/src/events/event-filter.ts
export type EventFilter = (event: RuntimeEvent) => boolean

export const filters = {
  byType: (type: string | RegExp): EventFilter =>
    event => typeof type === 'string'
      ? event.type === type
      : type.test(event.type),

  byNode: (nodeId: string): EventFilter =>
    event => event.payload?.nodeId === nodeId,

  after: (timestamp: number): EventFilter =>
    event => (event.timestamp ?? 0) > timestamp,

  successful: (): EventFilter =>
    event => !event.error
}

// 使用
const processEvents = runtime.drainEvents().filter(
  filters.byType(/^process:/)
)
```

#### 收益

- 更强大灵活的事件系统
- 支持异步监听器
- 支持一次性监听
- 内置事件过滤

---

### 9. 存储抽象 - Repository Pattern

**优先级**: ⭐⭐⭐
**影响范围**: 存储层
**复杂度**: 低

#### 优化方案

```typescript
// packages/core/src/storage/storage.interface.ts
export interface Query<T = any> {
  filter?: (item: T) => boolean
  sort?: (a: T, b: T) => number
  limit?: number
  offset?: number
}

export interface Storage<T extends { id: string }> {
  get: (id: string) => Promise<T | undefined>
  list: (query?: Query<T>) => Promise<T[]>
  save: (item: T) => Promise<void>
  delete: (id: string) => Promise<void>
  exists: (id: string) => Promise<boolean>
}

// packages/core/src/storage/file-storage.ts
export class FileStorage<T extends { id: string }> implements Storage<T> {
  constructor(
    private dir: string,
    private serializer: Serializer<T>
  ) {}

  async get(id: string): Promise<T | undefined> {
    const path = join(this.dir, `${id}.json`)
    if (!existsSync(path))
      return undefined

    const content = readFileSync(path, 'utf-8')
    return this.serializer.deserialize(content)
  }

  async list(query?: Query<T>): Promise<T[]> {
    const files = readdirSync(this.dir)
      .filter(f => f.endsWith('.json'))

    let items: T[] = files.map((file) => {
      const content = readFileSync(join(this.dir, file), 'utf-8')
      return this.serializer.deserialize(content)
    })

    if (query?.filter) {
      items = items.filter(query.filter)
    }
    if (query?.sort) {
      items.sort(query.sort)
    }
    if (query?.offset) {
      items = items.slice(query.offset)
    }
    if (query?.limit) {
      items = items.slice(0, query.limit)
    }

    return items
  }

  async save(item: T): Promise<void> {
    const path = join(this.dir, `${item.id}.json`)
    ensureDir(this.dir)
    writeFileSync(path, this.serializer.serialize(item))
  }

  async delete(id: string): Promise<void> {
    const path = join(this.dir, `${id}.json`)
    if (existsSync(path)) {
      unlinkSync(path)
    }
  }

  async exists(id: string): Promise<boolean> {
    return existsSync(join(this.dir, `${id}.json`))
  }
}

// Repository Pattern
export class NodeRepository {
  constructor(private storage: Storage<NodeInfo>) {}

  async findOnline(): Promise<NodeInfo[]> {
    return this.storage.list({
      filter: node => node.status === 'online'
    })
  }

  async findByHostname(hostname: string): Promise<NodeInfo[]> {
    return this.storage.list({
      filter: node => node.hostname === hostname
    })
  }

  async getStatistics(): Promise<NodeStatistics> {
    const nodes = await this.storage.list()
    return {
      total: nodes.length,
      online: nodes.filter(n => n.status === 'online').length,
      offline: nodes.filter(n => n.status === 'offline').length
    }
  }
}
```

#### 收益

- 统一的存储接口
- 易于切换存储实现（文件、数据库、内存）
- Repository 提供更高级的查询方法
- 更好的可测试性

---

### 10. 可测试性增强

**优先级**: ⭐⭐⭐⭐
**影响范围**: 全局
**复杂度**: 低

#### 优化方案

**抽象文件系统**
```typescript
// packages/core/src/fs/fs.interface.ts
export interface FileSystem {
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  exists: (path: string) => Promise<boolean>
  mkdir: (path: string) => Promise<void>
  delete: (path: string) => Promise<void>
  readdir: (path: string) => Promise<string[]>
}

// packages/core/src/fs/node-fs.ts
export class NodeFileSystem implements FileSystem {
  async readFile(path: string): Promise<string> {
    return readFileSync(path, 'utf-8')
  }

  async writeFile(path: string, content: string): Promise<void> {
    writeFileSync(path, content, 'utf-8')
  }
  // ...
}

// packages/core/src/fs/memory-fs.ts (用于测试)
export class MemoryFileSystem implements FileSystem {
  private files = new Map<string, string>()
  private dirs = new Set<string>(['./'])

  async readFile(path: string): Promise<string> {
    return this.files.get(path) || ''
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content)
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path)
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path)
  }

  async delete(path: string): Promise<void> {
    this.files.delete(path)
  }

  async readdir(path: string): Promise<string[]> {
    return Array.from(this.files.keys())
      .filter(f => f.startsWith(path))
      .map(f => f.slice(path.length))
  }
}
```

**抽象 HTTP 客户端**
```typescript
// packages/core/src/http/http-client.interface.ts
export interface HttpClient {
  get: <T = any>(url: string, options?: RequestOptions) => Promise<T>
  post: <T = any>(url: string, data: any, options?: RequestOptions) => Promise<T>
  download: (url: string, dest: string) => Promise<void>
}

// packages/core/src/http/axios-client.ts
export class AxiosHttpClient implements HttpClient {
  async get<T>(url: string): Promise<T> {
    const response = await axios.get(url)
    return response.data
  }
  // ...
}

// packages/core/src/http/mock-client.ts (用于测试)
export class MockHttpClient implements HttpClient {
  private responses = new Map<string, any>()

  mock<T>(url: string, response: T): void {
    this.responses.set(url, response)
  }

  async get<T>(url: string): Promise<T> {
    return this.responses.get(url)
  }
}
```

#### 收益

- 所有依赖可 mock
- 单元测试更快
- 不依赖真实文件系统
- 测试隔离性更好

---

### 11. 类型安全增强

**优先级**: ⭐⭐⭐
**影响范围**: 类型定义
**复杂度**: 低

#### 优化方案

**Branded Types**
```typescript
// packages/types/src/branded-types.ts
export type NodeId = string & { readonly __brand: unique symbol }
export type TunnelName = string & { readonly __brand: unique symbol }
export type Port = number & { readonly __brand: unique symbol }

export function createNodeId(id: string): NodeId {
  if (!id || id.length === 0) {
    throw new Error('Invalid node ID')
  }
  return id as NodeId
}

export function createTunnelName(name: string): TunnelName {
  if (!name || name.length === 0) {
    throw new Error('Invalid tunnel name')
  }
  return name as TunnelName
}

export function createPort(port: number): Port {
  if (port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`)
  }
  return port as Port
}

// 使用 - 类型不会混淆
function getTunnel(nodeId: NodeId, name: TunnelName): ProxyConfig | null { /* ... */ }

// 编译错误!
getTunnel(createNodeId('xxx'), 'ssh')
getTunnel('xxx', createTunnelName('ssh'))

// 正确
getTunnel(createNodeId('xxx'), createTunnelName('ssh'))
```

**严格的类型推导**
```typescript
// packages/core/src/runtime/command-registry.ts
export class CommandRegistry {
  private handlers = new Map<string, CommandHandler<any, any>>()

  register<TPayload, TResult>(
    name: string,
    handler: CommandHandler<TPayload, TResult>
  ): this {
    this.handlers.set(name, handler)
    return this
  }

  async execute<TPayload, TResult>(
    command: RuntimeCommand<TPayload>
  ): Promise<CommandResult<TResult>> {
    const handler = this.handlers.get(command.name) as
      CommandHandler<TPayload, TResult> | undefined

    if (!handler) {
      throw new Error(`Unknown command: ${command.name}`)
    }

    return handler(command, context)
  }
}

// 使用时获得完整的类型推导
const result = await registry.execute<
  ProxyAddPayload,
  ProxyConfig
>({
  name: 'proxy.add',
  payload: {
    proxy: { type: 'tcp', name: 'ssh', localPort: 22, remotePort: 6000 }
  }
})

// result.result 的类型是 ProxyConfig
const tunnel: ProxyConfig = result.result
```

#### 收益

- 编译时类型检查
- 防止类型混淆
- 更好的 IDE 支持
- 减少运行时错误

---

### 12. 安全性增强

**优先级**: ⭐⭐⭐⭐
**影响范围**: 全局
**复杂度**: 低

#### 优化方案

**输入验证 Schema**
```typescript
// packages/core/src/validation/validator.ts
export interface Schema<T> {
  validate: (data: unknown) => ValidationResult & { data?: T }
}

export class ObjectSchema<T extends Record<string, any>> implements Schema<T> {
  constructor(private properties: { [K in keyof T]?: PropertySchema }) {}

  validate(data: unknown): ValidationResult & { data?: T } {
    if (typeof data !== 'object' || data === null) {
      return { valid: false, error: 'Expected an object' }
    }

    const errors: string[] = []
    const result: any = {}

    for (const [key, schema] of Object.entries(this.properties)) {
      const value = (data as any)[key]
      const validation = schema!.validate(value)

      if (!validation.valid) {
        errors.push(`${key}: ${validation.error}`)
      }
      else {
        result[key] = validation.data
      }
    }

    return errors.length === 0
      ? { valid: true, data: result }
      : { valid: false, error: errors.join(', ') }
  }
}

// 使用示例
const proxyAddSchema = new ObjectSchema<ProxyAddPayload>({
  proxy: new ObjectSchema({
    name: new StringSchema({ minLength: 1 }),
    type: new EnumSchema(['tcp', 'udp', 'http', 'https', 'stcp', 'xtcp']),
    localPort: new NumberSchema({ min: 1, max: 65535 }),
    remotePort: new NumberSchema({ min: 1, max: 65535, optional: true })
  }),
  nodeId: new StringSchema({ optional: true })
})

export function createProxyAddCommand() {
  return withValidation(
    payload => proxyAddSchema.validate(payload),
    async (command, ctx) => {
      // 业务逻辑
    }
  )
}
```

**敏感信息脱敏**
```typescript
// packages/core/src/logger/sanitizer.ts
export class LogSanitizer {
  private static SENSITIVE_FIELDS = ['token', 'password', 'secret', 'authToken']

  static sanitize(obj: any): any {
    if (typeof obj !== 'object' || obj === null)
      return obj

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitize(item))
    }

    const sanitized: any = {}
    for (const [key, value] of Object.entries(obj)) {
      if (this.SENSITIVE_FIELDS.includes(key)) {
        sanitized[key] = '***REDACTED***'
      }
      else if (typeof value === 'object') {
        sanitized[key] = this.sanitize(value)
      }
      else {
        sanitized[key] = value
      }
    }
    return sanitized
  }
}

// 使用
logger.info('Node registered', {
  node: LogSanitizer.sanitize(nodeInfo)
})
// 输出: { node: { id: 'xxx', token: '***REDACTED***', ... } }
```

#### 收益

- 统一的输入验证
- 防止敏感信息泄露
- 更好的安全性

---

## 设计模式应用总结

### 应用的设计模式

| 模式 | 应用场景 | 优化项 |
|------|---------|--------|
| **Strategy Pattern** | TOML 处理、配置合并、平台相关操作 | 1, 2, 4 |
| **Builder Pattern** | TOML 生成 | 4 |
| **Single Responsibility Principle** | 进程管理拆分 | 2 |
| **Repository Pattern** | 存储抽象 | 9 |
| **Decorator Pattern** | 命令处理器增强 | 6 |
| **Template Method Pattern** | Server/Client 转发逻辑 | 6 |
| **Chain of Responsibility** | RPC 中间件 | 5 |
| **Dependency Injection** | IoC 容器 | 7 |
| **Observer Pattern** | 事件总线 | 8 |
| **Factory Pattern** | 平台策略创建 | 2 |
| **Command Pattern** | 配置操作 | 2 |

### SOLID 原则应用

- **S**ingle Responsibility: 类职责单一化（TunnelManager、BinaryManager）
- **O**pen/Closed: 通过策略模式扩展功能，无需修改现有代码
- **L**iskov Substitution: 所有策略可互换使用
- **I**nterface Segregation: 小而专注的接口（FileSystem、HttpClient、Storage）
- **D**ependency Inversion: 依赖抽象而非具体实现

---

## 实施建议

### 第一阶段（2-3 周）

1. **TOML 处理统一化** (2 天)
   - 评估并选择 TOML 库
   - 创建统一的 TOML 模块
   - 替换所有使用点

2. **进程管理拆分** (1 周)
   - 创建 PlatformStrategy
   - 提取 TunnelManager
   - 提取 BinaryManager
   - 重构 FrpProcessManager
   - 编写单元测试

3. **错误处理统一化** (3 天)
   - 创建错误层次结构
   - 实现 ErrorHandler
   - 更新所有 handlers

### 第二阶段（2-3 周）

4. **配置管理优化** (4 天)
   - 实现策略模式
   - 实现 TomlBuilder
   - 更新测试

5. **RPC 中间件** (5 天)
   - 消息类型枚举
   - 中间件系统
   - 指数退避重连
   - 更新测试

6. **命令处理器装饰器** (4 天)
   - 实现装饰器函数
   - 重构现有 handlers
   - 添加单元测试

### 第三阶段（2 周）

7. **依赖注入容器** (3 天)
8. **事件总线增强** (2 天)
9. **存储抽象** (3 天)
10. **可测试性增强** (4 天)
11. **类型安全增强** (2 天)
12. **安全性增强** (2 天)

---

## 测试策略

### 单元测试

- **目标覆盖率**: 80%+
- **工具**: Vitest
- **重点模块**:
  - TOML 处理
  - 配置合并
  - 命令处理器
  - 错误处理

### 集成测试

- 测试各模块协作
- 使用 Mock 外部依赖
- 测试错误场景

### E2E 测试

- 完整的启动流程
- RPC 通信
- 配置合并和应用

---

## 风险和缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 引入新的依赖 | 兼容性问题 | 选择成熟、维护活跃的库 |
| 大规模重构 | 破坏现有功能 | 分阶段实施，充分测试 |
| 学习曲线 | 团队适应 | 文档和代码示例 |
| 性能影响 | 优化可能降低性能 | 基准测试，优化热点 |

---

## 总结

本优化路线图涵盖了 12 个主要优化方向，应用了 11 种设计模式，预计可：

- **减少重复代码**: ~500 行
- **提高可测试性**: 模块化程度提升 80%
- **增强类型安全**: 消除 90% 的类型断言
- **提升可维护性**: 代码复杂度降低 40%

建议按优先级分阶段实施，每个阶段完成后进行充分测试，确保不影响现有功能。

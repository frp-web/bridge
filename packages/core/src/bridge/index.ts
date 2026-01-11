import type { ClientConfig, NodeHeartbeatPayload, NodeInfo, NodeRegisterPayload, ProxyConfig, RpcRequest, ServerConfig } from '@frp-bridge/types'
import type { FrpProcessManagerOptions, ProcessEvent } from '../process'
import type { CommandHandler, CommandHandlerContext, CommandResult, QueryHandler, QueryResult, RuntimeCommand, RuntimeContext, RuntimeEvent, RuntimeLogger, RuntimeMode, RuntimeQuery, RuntimeState, SnapshotStorage } from '../runtime'
import { homedir } from 'node:os'
import process from 'node:process'
import { consola } from 'consola'
import { join } from 'pathe'
import { ClientNodeCollector, FileNodeStorage, NodeManager } from '../node'
import { FrpProcessManager } from '../process'
import { RpcClient, RpcServer } from '../rpc'
import { FrpRuntime } from '../runtime'
import { FileSnapshotStorage } from '../runtime/file-snapshot-storage'
import { ensureDir, parseToml } from '../utils'
import { DEFAULT_COMMAND_APPLY, DEFAULT_COMMAND_APPLY_RAW, DEFAULT_COMMAND_STOP, DEFAULT_QUERY_SNAPSHOT, DEFAULT_QUERY_STATUS } from './commands'

export interface ConfigApplyPayload {
  config: Partial<ClientConfig | ServerConfig>
  restart?: boolean
  configPath?: string
}

export interface ConfigApplyRawPayload {
  content: string
  restart?: boolean
  configPath?: string
}

export interface ProxyAddPayload {
  proxy: ProxyConfig
  nodeId?: string // Target node ID (for server mode RPC forwarding)
}

export interface ProxyUpdatePayload {
  name: string
  proxy: Partial<ProxyConfig>
  nodeId?: string // Target node ID (for server mode RPC forwarding)
}

export interface ProxyRemovePayload {
  name: string
  nodeId?: string // Target node ID (for server mode RPC forwarding)
}

export interface ProxyGetPayload {
  name: string
}

interface FrpBridgeRuntimeOptions {
  id?: string
  mode?: RuntimeMode
  logger?: RuntimeLogger
  clock?: () => number
  platform?: string
  workDir?: string
}

interface FrpBridgeProcessOptions extends Partial<Omit<FrpProcessManagerOptions, 'mode'>> {
  mode?: 'client' | 'server'
}

interface FrpBridgeRpcOptions {
  serverPort?: number
  serverHeartbeatInterval?: number
  serverValidateToken?: (token: string | undefined, nodeId: string | undefined) => boolean | Promise<boolean>
  serverAuthorize?: (nodeId: string, method: string) => boolean | Promise<boolean>
  clientUrl?: string
  clientNodeId?: string
  clientToken?: string
  clientReconnectInterval?: number
  getRegisterPayload?: () => Promise<NodeInfo> | NodeInfo
  handleRequest?: (req: RpcRequest) => Promise<unknown>
}

export interface FrpBridgeOptions {
  mode: 'client' | 'server'
  workDir?: string
  configPath?: string
  runtime?: FrpBridgeRuntimeOptions
  process?: FrpBridgeProcessOptions
  rpc?: FrpBridgeRpcOptions
  storage?: SnapshotStorage
  commands?: Record<string, CommandHandler>
  queries?: Record<string, QueryHandler>
  eventSink?: (event: RuntimeEvent) => void
}

export class FrpBridge {
  private readonly runtime: FrpRuntime
  private readonly process: FrpProcessManager
  private readonly mode: 'client' | 'server'
  private readonly eventSink?: (event: RuntimeEvent) => void
  private readonly nodeManager?: NodeManager
  private readonly clientCollector?: ClientNodeCollector
  private readonly rpcServer?: RpcServer
  private readonly rpcClient?: RpcClient

  constructor(private readonly options: FrpBridgeOptions) {
    this.mode = options.mode
    const rootWorkDir = options.workDir ?? join(homedir(), '.frp-bridge')
    const runtimeDir = options.runtime?.workDir ?? join(rootWorkDir, 'runtime')
    const processDir = options.process?.workDir ?? join(rootWorkDir, 'process')

    ensureDir(rootWorkDir)
    ensureDir(runtimeDir)
    ensureDir(processDir)

    const runtimeLogger = options.runtime?.logger ?? consola.withTag('FrpRuntime')
    const processLogger = options.process?.logger ?? consola.withTag('FrpProcessManager')

    this.process = new FrpProcessManager({
      mode: options.process?.mode ?? options.mode,
      version: options.process?.version,
      workDir: processDir,
      configPath: options.configPath,
      logger: processLogger
    })

    const storage = options.storage ?? new FileSnapshotStorage(join(runtimeDir, 'snapshots'))
    const runtimeContext: RuntimeContext = {
      id: options.runtime?.id ?? 'default',
      mode: options.runtime?.mode ?? options.mode,
      workDir: runtimeDir,
      platform: options.runtime?.platform ?? process.platform,
      clock: options.runtime?.clock,
      logger: runtimeLogger
    }

    // Initialize NodeManager for server mode
    if (options.mode === 'server') {
      const nodeStorageDir = join(runtimeDir, 'nodes')
      ensureDir(nodeStorageDir)
      const nodeStorage = new FileNodeStorage(nodeStorageDir)
      this.nodeManager = new NodeManager(runtimeContext, {
        heartbeatTimeout: 90000, // 90 seconds
        logger: runtimeLogger
      }, nodeStorage)
    }

    // Initialize ClientNodeCollector for client mode
    if (options.mode === 'client') {
      this.clientCollector = new ClientNodeCollector({
        heartbeatInterval: 30000, // 30 seconds
        logger: consola.withTag('ClientNodeCollector')
      })
    }

    const rpcOptions = options.rpc

    if (options.mode === 'server' && rpcOptions?.serverPort) {
      this.rpcServer = new RpcServer({
        port: rpcOptions.serverPort,
        heartbeatInterval: rpcOptions.serverHeartbeatInterval,
        validateToken: rpcOptions.serverValidateToken,
        authorize: rpcOptions.serverAuthorize,
        logger: consola.withTag('RpcServer')
      })
    }

    if (options.mode === 'client' && rpcOptions?.clientUrl && rpcOptions.clientNodeId) {
      const urlWithToken = this.appendToken(rpcOptions.clientUrl, rpcOptions.clientToken)
      this.rpcClient = new RpcClient({
        url: urlWithToken,
        nodeId: rpcOptions.clientNodeId,
        reconnectInterval: rpcOptions.clientReconnectInterval,
        getRegisterPayload: rpcOptions.getRegisterPayload ?? (async () => {
          throw new Error('rpc getRegisterPayload is required in client mode')
        }),
        handleRequest: rpcOptions.handleRequest ?? (async () => undefined),
        logger: consola.withTag('RpcClient')
      })
    }

    const commands = {
      ...this.createDefaultCommands(),
      ...(options.commands ?? {})
    }

    const queries = {
      ...this.createDefaultQueries(),
      ...(options.queries ?? {})
    }

    this.runtime = new FrpRuntime(runtimeContext, {
      storage,
      commands,
      queries
    })

    this.eventSink = options.eventSink
    this.setupProcessEventBridge()
  }

  execute<TPayload, TResult = unknown>(command: RuntimeCommand<TPayload>): Promise<CommandResult<TResult>> {
    return this.runtime.execute<TPayload, TResult>(command).finally(() => {
      this.forwardEvents()
    })
  }

  query<TPayload, TResult = unknown>(query: RuntimeQuery<TPayload>): Promise<QueryResult<TResult>> {
    return this.runtime.query<TPayload, TResult>(query).finally(() => {
      this.forwardEvents()
    })
  }

  snapshot(): RuntimeState {
    return this.runtime.snapshot()
  }

  drainEvents(): RuntimeEvent[] {
    return this.runtime.drainEvents()
  }

  getProcessManager(): FrpProcessManager {
    return this.process
  }

  getRuntime(): FrpRuntime {
    return this.runtime
  }

  getNodeManager(): NodeManager | undefined {
    return this.nodeManager
  }

  getClientCollector(): ClientNodeCollector | undefined {
    return this.clientCollector
  }

  getRpcServer(): RpcServer | undefined {
    return this.rpcServer
  }

  getRpcClient(): RpcClient | undefined {
    return this.rpcClient
  }

  async initialize(): Promise<void> {
    // Initialize NodeManager if in server mode
    if (this.nodeManager) {
      await this.nodeManager.initialize()
    }

    if (this.rpcServer) {
      this.rpcServer.start()
    }

    if (this.rpcClient) {
      await this.rpcClient.connect()
    }
  }

  async dispose(): Promise<void> {
    // Cleanup NodeManager if in server mode
    if (this.nodeManager) {
      this.nodeManager.dispose()
    }

    // Cleanup ClientNodeCollector if in client mode
    if (this.clientCollector) {
      this.clientCollector.stopHeartbeat()
    }

    if (this.rpcServer) {
      this.rpcServer.stop()
    }

    if (this.rpcClient) {
      this.rpcClient.disconnect()
    }
  }

  private createDefaultCommands(): Record<string, CommandHandler<any, any>> {
    const apply: CommandHandler<ConfigApplyPayload> = async (command, ctx) => {
      if (!command.payload?.config) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'config.apply requires payload.config'
          }
        }
      }

      return this.runConfigMutation(async () => {
        this.process.updateConfig(command.payload!.config)
      }, command.payload.restart, ctx)
    }

    const applyRaw: CommandHandler<ConfigApplyRawPayload> = async (command, ctx) => {
      const content = command.payload?.content
      if (!content?.trim()) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'config.applyRaw requires payload.content'
          }
        }
      }

      try {
        parseToml(content)
      }
      catch (error) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'config.applyRaw received invalid TOML content',
            details: error instanceof Error ? { message: error.message } : undefined
          }
        }
      }

      return this.runConfigMutation(async () => {
        this.process.updateConfigRaw(content)
      }, command.payload?.restart, ctx)
    }

    const stop: CommandHandler = async () => {
      if (this.process.isRunning()) {
        await this.process.stop()
        return {
          status: 'success',
          events: [
            {
              type: 'process:stopped',
              timestamp: Date.now()
            }
          ]
        }
      }

      return {
        status: 'success'
      }
    }

    // Node management commands (server mode only)
    const nodeRegister: CommandHandler<NodeRegisterPayload> = async (command) => {
      if (!this.nodeManager) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'node.register is only available in server mode'
          }
        }
      }

      const payload = command.payload
      if (!payload || !payload.hostname || !payload.serverAddr || !payload.serverPort) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'node.register requires hostname, serverAddr, and serverPort'
          }
        }
      }

      try {
        const nodeInfo = await this.nodeManager.registerNode(payload)
        return {
          status: 'success',
          result: nodeInfo
        }
      }
      catch (error) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: error instanceof Error ? error.message : 'Failed to register node'
          }
        }
      }
    }

    const nodeHeartbeat: CommandHandler<NodeHeartbeatPayload> = async (command) => {
      if (!this.nodeManager) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'node.heartbeat is only available in server mode'
          }
        }
      }

      const payload = command.payload
      if (!payload || !payload.nodeId) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'node.heartbeat requires nodeId'
          }
        }
      }

      try {
        await this.nodeManager.updateHeartbeat(payload)
        return {
          status: 'success'
        }
      }
      catch (error) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: error instanceof Error ? error.message : 'Failed to process heartbeat'
          }
        }
      }
    }

    const nodeUnregister: CommandHandler<{ nodeId: string }> = async (command) => {
      if (!this.nodeManager) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'node.unregister is only available in server mode'
          }
        }
      }

      const nodeId = command.payload?.nodeId
      if (!nodeId) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'node.unregister requires nodeId'
          }
        }
      }

      try {
        this.nodeManager.unregisterNode(nodeId)
        return {
          status: 'success'
        }
      }
      catch (error) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: error instanceof Error ? error.message : 'Failed to unregister node'
          }
        }
      }
    }

    // Helper function to check if proxy type uses remotePort
    const typeUsesRemotePort = (type: string): boolean => {
      return ['tcp', 'udp', 'stcp', 'xtcp', 'sudp', 'tcpmux'].includes(type)
    }

    // Proxy/tunnel management commands
    const proxyAdd: CommandHandler<ProxyAddPayload> = async (command, _ctx) => {
      const payload = command.payload
      if (!payload || !payload.proxy) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'proxy.add requires payload.proxy'
          }
        }
      }

      // Server mode: forward to node via RPC or validate globally
      if (this.mode === 'server') {
        if (!payload.nodeId) {
          return {
            status: 'failed',
            error: {
              code: 'VALIDATION_ERROR',
              message: 'proxy.add requires payload.nodeId in server mode'
            }
          }
        }

        // Check global port conflict before forwarding
        const proxyRemotePort = (payload.proxy as any).remotePort
        if (proxyRemotePort && typeUsesRemotePort(payload.proxy.type)) {
          const portCheck = this.nodeManager?.isRemotePortInUse(proxyRemotePort, payload.nodeId)
          if (portCheck?.inUse) {
            return {
              status: 'failed',
              error: {
                code: 'PORT_CONFLICT',
                message: `Remote port ${proxyRemotePort} is already in use by tunnel "${portCheck.tunnelName}" on node ${portCheck.nodeId}`
              }
            }
          }
        }

        // Forward to node via RPC
        if (!this.rpcServer) {
          return {
            status: 'failed',
            error: {
              code: 'RPC_NOT_AVAILABLE',
              message: 'RPC server not available'
            }
          }
        }

        try {
          const result = await this.rpcServer.rpcCall(payload.nodeId, 'proxy.add', { proxy: payload.proxy })
          return {
            status: 'success',
            result
          }
        }
        catch (error) {
          return {
            status: 'failed',
            error: {
              code: 'RPC_ERROR',
              message: error instanceof Error ? error.message : 'Failed to add tunnel on node'
            }
          }
        }
      }

      // Client mode: add locally
      try {
        this.process.addTunnel(payload.proxy)
        return {
          status: 'success',
          result: payload.proxy
        }
      }
      catch (error) {
        return {
          status: 'failed',
          error: {
            code: 'RUNTIME_ERROR',
            message: error instanceof Error ? error.message : 'Failed to add tunnel'
          }
        }
      }
    }

    const proxyUpdate: CommandHandler<ProxyUpdatePayload> = async (command, _ctx) => {
      const payload = command.payload
      if (!payload || !payload.name) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'proxy.update requires payload.name'
          }
        }
      }

      // Server mode: forward to node via RPC
      if (this.mode === 'server') {
        if (!payload.nodeId) {
          return {
            status: 'failed',
            error: {
              code: 'VALIDATION_ERROR',
              message: 'proxy.update requires payload.nodeId in server mode'
            }
          }
        }

        // Check global port conflict if remotePort is being changed
        const newRemotePort = (payload.proxy as any)?.remotePort
        if (newRemotePort && typeUsesRemotePort((payload.proxy as any)?.type)) {
          const portCheck = this.nodeManager?.isRemotePortInUse(newRemotePort, payload.nodeId)
          if (portCheck?.inUse) {
            return {
              status: 'failed',
              error: {
                code: 'PORT_CONFLICT',
                message: `Remote port ${newRemotePort} is already in use by tunnel "${portCheck.tunnelName}" on node ${portCheck.nodeId}`
              }
            }
          }
        }

        if (!this.rpcServer) {
          return {
            status: 'failed',
            error: {
              code: 'RPC_NOT_AVAILABLE',
              message: 'RPC server not available'
            }
          }
        }

        try {
          const result = await this.rpcServer.rpcCall(payload.nodeId, 'proxy.update', { name: payload.name, proxy: payload.proxy })
          return {
            status: 'success',
            result
          }
        }
        catch (error) {
          return {
            status: 'failed',
            error: {
              code: 'RPC_ERROR',
              message: error instanceof Error ? error.message : 'Failed to update tunnel on node'
            }
          }
        }
      }

      // Client mode: update locally
      try {
        this.process.updateTunnel(payload.name, payload.proxy)
        return {
          status: 'success',
          result: { name: payload.name, ...payload.proxy }
        }
      }
      catch (error) {
        return {
          status: 'failed',
          error: {
            code: 'RUNTIME_ERROR',
            message: error instanceof Error ? error.message : 'Failed to update tunnel'
          }
        }
      }
    }

    const proxyRemove: CommandHandler<ProxyRemovePayload> = async (command, _ctx) => {
      const payload = command.payload
      if (!payload || !payload.name) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'proxy.remove requires payload.name'
          }
        }
      }

      // Server mode: forward to node via RPC
      if (this.mode === 'server') {
        if (!payload.nodeId) {
          return {
            status: 'failed',
            error: {
              code: 'VALIDATION_ERROR',
              message: 'proxy.remove requires payload.nodeId in server mode'
            }
          }
        }

        if (!this.rpcServer) {
          return {
            status: 'failed',
            error: {
              code: 'RPC_NOT_AVAILABLE',
              message: 'RPC server not available'
            }
          }
        }

        try {
          const result = await this.rpcServer.rpcCall(payload.nodeId, 'proxy.remove', { name: payload.name })
          return {
            status: 'success',
            result
          }
        }
        catch (error) {
          return {
            status: 'failed',
            error: {
              code: 'RPC_ERROR',
              message: error instanceof Error ? error.message : 'Failed to remove tunnel on node'
            }
          }
        }
      }

      // Client mode: remove locally
      try {
        this.process.removeTunnel(payload.name)
        return {
          status: 'success',
          result: { name: payload.name }
        }
      }
      catch (error) {
        return {
          status: 'failed',
          error: {
            code: 'RUNTIME_ERROR',
            message: error instanceof Error ? error.message : 'Failed to remove tunnel'
          }
        }
      }
    }

    return {
      [DEFAULT_COMMAND_APPLY]: apply as CommandHandler,
      [DEFAULT_COMMAND_APPLY_RAW]: applyRaw as CommandHandler,
      [DEFAULT_COMMAND_STOP]: stop,
      'node.register': nodeRegister,
      'node.heartbeat': nodeHeartbeat,
      'node.unregister': nodeUnregister,
      'proxy.add': proxyAdd,
      'proxy.update': proxyUpdate,
      'proxy.remove': proxyRemove
    }
  }

  private createDefaultQueries(): Record<string, QueryHandler> {
    const status: QueryHandler = async () => {
      const runtimeState = this.runtime.snapshot()
      return {
        result: {
          running: this.process.isRunning(),
          config: this.process.getConfig()
        },
        version: runtimeState.version
      }
    }

    const snapshot: QueryHandler = async () => {
      const runtimeState = this.runtime.snapshot()
      return {
        result: runtimeState,
        version: runtimeState.version
      }
    }

    // Node management queries (server mode only)
    const nodeList: QueryHandler = async () => {
      if (!this.nodeManager) {
        return {
          result: {
            items: [],
            total: 0,
            page: 1,
            pageSize: 100,
            hasMore: false
          },
          version: this.runtime.snapshot().version
        }
      }

      const query = {
        page: 1,
        pageSize: 100
      }

      const result = this.nodeManager.listNodes(query)
      return {
        result,
        version: this.runtime.snapshot().version
      }
    }

    const nodeGet: QueryHandler = async (query) => {
      if (!this.nodeManager) {
        return {
          result: null,
          version: this.runtime.snapshot().version
        }
      }

      const nodeId = (query.payload as any)?.nodeId
      if (!nodeId) {
        return {
          result: null,
          version: this.runtime.snapshot().version
        }
      }

      const node = this.nodeManager.getNode(nodeId)
      return {
        result: node ?? null,
        version: this.runtime.snapshot().version
      }
    }

    const nodeStatistics: QueryHandler = async () => {
      if (!this.nodeManager) {
        return {
          result: {
            total: 0,
            online: 0,
            offline: 0,
            connecting: 0,
            error: 0
          },
          version: this.runtime.snapshot().version
        }
      }

      const stats = this.nodeManager.getStatistics()
      return {
        result: stats,
        version: this.runtime.snapshot().version
      }
    }

    // Proxy/tunnel management queries (client mode only)
    const proxyList: QueryHandler = async () => {
      if (this.mode !== 'client') {
        return {
          result: [],
          version: this.runtime.snapshot().version
        }
      }

      try {
        const tunnels = this.process.listTunnels()
        return {
          result: tunnels,
          version: this.runtime.snapshot().version
        }
      }
      catch {
        return {
          result: [],
          version: this.runtime.snapshot().version
        }
      }
    }

    const proxyGet: QueryHandler = async (query) => {
      if (this.mode !== 'client') {
        return {
          result: null,
          version: this.runtime.snapshot().version
        }
      }

      const name = (query.payload as ProxyGetPayload)?.name
      if (!name) {
        return {
          result: null,
          version: this.runtime.snapshot().version
        }
      }

      try {
        const tunnel = this.process.getTunnel(name)
        return {
          result: tunnel ?? null,
          version: this.runtime.snapshot().version
        }
      }
      catch {
        return {
          result: null,
          version: this.runtime.snapshot().version
        }
      }
    }

    return {
      [DEFAULT_QUERY_STATUS]: status,
      [DEFAULT_QUERY_SNAPSHOT]: snapshot,
      'node.list': nodeList,
      'node.get': nodeGet,
      'node.statistics': nodeStatistics,
      'proxy.list': proxyList,
      'proxy.get': proxyGet
    }
  }

  private forwardEvents(): void {
    if (!this.eventSink) {
      return
    }

    const events = this.runtime.drainEvents()
    events.forEach(event => this.eventSink?.(event))
  }

  private async runConfigMutation(
    mutate: () => Promise<void> | void,
    restart: boolean | undefined,
    ctx: CommandHandlerContext
  ): Promise<CommandResult> {
    await mutate()

    const shouldRestart = restart ?? true
    let events: RuntimeEvent[] | undefined

    if (shouldRestart) {
      if (this.process.isRunning()) {
        await this.process.stop()
      }
      await this.process.start()
      events = [
        {
          type: 'process:started',
          timestamp: Date.now()
        }
      ]
    }

    ctx.requestVersionBump()

    return {
      status: 'success',
      events
    }
  }

  private appendToken(url: string, token?: string): string {
    if (!token) {
      return url
    }
    const target = new URL(url)
    target.searchParams.set('token', token)
    return target.toString()
  }

  private setupProcessEventBridge(): void {
    if (!this.eventSink) {
      return
    }

    this.process.on('process:started', (event: ProcessEvent) => {
      this.eventSink?.(event as RuntimeEvent)
    })

    this.process.on('process:stopped', (event: ProcessEvent) => {
      this.eventSink?.(event as RuntimeEvent)
    })

    this.process.on('process:exited', (event: ProcessEvent) => {
      this.eventSink?.(event as RuntimeEvent)
    })

    this.process.on('process:error', (event: ProcessEvent) => {
      this.eventSink?.(event as RuntimeEvent)
    })
  }
}

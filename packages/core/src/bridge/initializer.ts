import type { NodeInfo, RpcRequest } from '@frp-bridge/types'

import type { FrpProcessManagerOptions, ProcessEvent } from '../process'
import type { RuntimeContext, RuntimeEvent, RuntimeMode, SnapshotStorage } from '../runtime'

import { homedir } from 'node:os'
import process from 'node:process'
import { setGlobalLoggerOptions } from '@frp-bridge/shared'
import { join } from 'pathe'
import { ClientNodeCollector, FileNodeStorage, NodeManager } from '../node'
import { FrpProcessManager } from '../process'
import { RpcClient, RpcServer } from '../rpc'
import { ensureDir } from '../utils'

export interface FrpBridgeRuntimeOptions {
  id?: string
  mode?: RuntimeMode
  clock?: () => number
  platform?: string
  workDir?: string
}

export interface FrpBridgeProcessOptions extends Partial<Omit<FrpProcessManagerOptions, 'mode'>> {
  mode?: 'client' | 'server'
}

export interface FrpBridgeRpcOptions {
  serverPort?: number
  serverHeartbeatInterval?: number
  serverValidateToken?: (token: string | undefined, nodeId: string | undefined) => boolean | Promise<boolean>
  serverAuthorize?: (nodeId: string, method: string) => boolean | Promise<boolean>
  serverOnRegister?: (nodeId: string, payload: NodeInfo) => void | Promise<void>
  serverOnEvent?: (nodeId: string, event: import('../rpc/message-types').EventRpcMessage) => void | Promise<void>
  serverCommandTimeout?: number
  clientUrl?: string
  clientNodeId?: string
  clientToken?: string
  clientReconnectInterval?: number
  getRegisterPayload?: () => Promise<NodeInfo> | NodeInfo
  handleRequest?: (req: RpcRequest) => Promise<unknown>
}

export interface InitializationConfig {
  mode: 'client' | 'server'
  workDir?: string
  configPath?: string
  runtime?: FrpBridgeRuntimeOptions
  process?: FrpBridgeProcessOptions
  rpc?: FrpBridgeRpcOptions
  storage?: SnapshotStorage
  eventSink?: (event: RuntimeEvent) => void
}

export interface InitializationResult {
  runtimeContext: RuntimeContext
  process: FrpProcessManager
  nodeManager?: NodeManager
  clientCollector?: ClientNodeCollector
  rpcServer?: RpcServer
  rpcClient?: RpcClient
  rootWorkDir: string
  runtimeDir: string
  processDir: string
}

/**
 * Handles initialization of all FrpBridge components
 * This follows the Single Responsibility Principle by separating initialization logic
 */
export class FrpBridgeInitializer {
  constructor(private readonly config: InitializationConfig) {}

  /**
   * Initialize all components
   */
  initialize(): InitializationResult {
    const { rootWorkDir, runtimeDir, processDir } = this.setupDirectories()

    // Configure global logger options with workspace root
    setGlobalLoggerOptions({
      workspaceRoot: rootWorkDir,
      enableFile: true
    })

    const process = this.createProcessManager(rootWorkDir, processDir)
    const runtimeContext = this.createRuntimeContext(runtimeDir)

    const nodeManager = this.createNodeManager(runtimeContext, runtimeDir)
    const clientCollector = this.createClientCollector()
    const { rpcServer, rpcClient } = this.createRpcComponents()

    return {
      runtimeContext,
      process,
      nodeManager,
      clientCollector,
      rpcServer,
      rpcClient,
      rootWorkDir,
      runtimeDir,
      processDir
    }
  }

  /**
   * Setup and create working directories
   */
  private setupDirectories(): { rootWorkDir: string, runtimeDir: string, processDir: string } {
    const rootWorkDir = this.config.workDir ?? join(homedir(), '.frp-web')
    const runtimeDir = this.config.runtime?.workDir ?? join(rootWorkDir, 'runtime')
    const processDir = this.config.process?.workDir ?? join(rootWorkDir, 'process')

    ensureDir(rootWorkDir)
    ensureDir(runtimeDir)
    ensureDir(processDir)

    return { rootWorkDir, runtimeDir, processDir }
  }

  /**
   * Create process manager
   */
  private createProcessManager(rootWorkDir: string, processDir: string): FrpProcessManager {
    return new FrpProcessManager({
      mode: this.config.process?.mode ?? this.config.mode,
      version: this.config.process?.version,
      workDir: processDir,
      configPath: this.config.configPath,
      configDir: join(rootWorkDir, 'config')
    })
  }

  /**
   * Create runtime context
   */
  private createRuntimeContext(runtimeDir: string): RuntimeContext {
    return {
      id: this.config.runtime?.id ?? 'default',
      mode: this.config.runtime?.mode ?? this.config.mode,
      workDir: runtimeDir,
      platform: this.config.runtime?.platform ?? process.platform,
      clock: this.config.runtime?.clock
    }
  }

  /**
   * Create node manager (server mode only)
   */
  private createNodeManager(runtimeContext: RuntimeContext, runtimeDir: string): NodeManager | undefined {
    if (this.config.mode !== 'server') {
      return undefined
    }

    const nodeStorageDir = join(runtimeDir, 'nodes')
    ensureDir(nodeStorageDir)
    const nodeStorage = new FileNodeStorage(nodeStorageDir)

    return new NodeManager(runtimeContext, {
      heartbeatTimeout: 90000 // 90 seconds
    }, nodeStorage)
  }

  /**
   * Create client node collector (client mode only)
   */
  private createClientCollector(): ClientNodeCollector | undefined {
    if (this.config.mode !== 'client') {
      return undefined
    }

    return new ClientNodeCollector({
      heartbeatInterval: 30000 // 30 seconds
    })
  }

  /**
   * Create RPC components (server and client)
   */
  private createRpcComponents(): { rpcServer?: RpcServer, rpcClient?: RpcClient } {
    const rpcOptions = this.config.rpc
    const result: { rpcServer?: RpcServer, rpcClient?: RpcClient } = {}

    if (this.config.mode === 'server' && rpcOptions?.serverPort) {
      result.rpcServer = new RpcServer({
        port: rpcOptions.serverPort,
        heartbeatInterval: rpcOptions.serverHeartbeatInterval,
        validateToken: rpcOptions.serverValidateToken,
        authorize: rpcOptions.serverAuthorize,
        onRegister: rpcOptions.serverOnRegister,
        onEvent: rpcOptions.serverOnEvent,
        commandTimeout: rpcOptions.serverCommandTimeout
      })
    }

    if (this.config.mode === 'client' && rpcOptions?.clientUrl && rpcOptions.clientNodeId) {
      const urlWithToken = this.appendToken(rpcOptions.clientUrl, rpcOptions.clientToken)
      result.rpcClient = new RpcClient({
        url: urlWithToken,
        nodeId: rpcOptions.clientNodeId,
        getRegisterPayload: rpcOptions.getRegisterPayload ?? (async () => {
          throw new Error('rpc getRegisterPayload is required in client mode')
        }),
        handleRequest: rpcOptions.handleRequest ?? (async () => undefined)
      })
    }

    return result
  }

  /**
   * Append token to URL for authentication
   */
  private appendToken(url: string, token?: string): string {
    if (!token) {
      return url
    }
    const target = new URL(url)
    target.searchParams.set('token', token)
    return target.toString()
  }
}

/**
 * Setup process event bridging to external event sink
 */
export function setupProcessEventBridge(
  process: FrpProcessManager,
  eventSink?: (event: RuntimeEvent) => void
): void {
  if (!eventSink) {
    return
  }

  process.on('process:started', (event: ProcessEvent) => {
    eventSink(event as RuntimeEvent)
  })

  process.on('process:stopped', (event: ProcessEvent) => {
    eventSink(event as RuntimeEvent)
  })

  process.on('process:exited', (event: ProcessEvent) => {
    eventSink(event as RuntimeEvent)
  })

  process.on('process:error', (event: ProcessEvent) => {
    eventSink(event as RuntimeEvent)
  })
}

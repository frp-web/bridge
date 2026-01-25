import type { NodeInfo, RpcRequest } from '@frp-bridge/types'

import type { FrpProcessManagerOptions, ProcessEvent } from '../process'
import type { RuntimeContext, RuntimeEvent, RuntimeLogger, RuntimeMode, SnapshotStorage } from '../runtime'

import { homedir } from 'node:os'
import process from 'node:process'
import { consola } from 'consola'
import { join } from 'pathe'
import { ClientNodeCollector, FileNodeStorage, NodeManager } from '../node'
import { FrpProcessManager } from '../process'
import { RpcClient, RpcServer } from '../rpc'
import { ensureDir } from '../utils'

export interface FrpBridgeRuntimeOptions {
  id?: string
  mode?: RuntimeMode
  logger?: RuntimeLogger
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
    const loggers = this.createLoggers()

    const process = this.createProcessManager(processDir, loggers.processLogger)
    const runtimeContext = this.createRuntimeContext(runtimeDir, loggers.runtimeLogger)

    const nodeManager = this.createNodeManager(runtimeContext, runtimeDir, loggers.runtimeLogger)
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
    const rootWorkDir = this.config.workDir ?? join(homedir(), '.frp-bridge')
    const runtimeDir = this.config.runtime?.workDir ?? join(rootWorkDir, 'runtime')
    const processDir = this.config.process?.workDir ?? join(rootWorkDir, 'process')

    ensureDir(rootWorkDir)
    ensureDir(runtimeDir)
    ensureDir(processDir)

    return { rootWorkDir, runtimeDir, processDir }
  }

  /**
   * Create loggers for different components
   */
  private createLoggers(): { runtimeLogger: RuntimeLogger, processLogger: RuntimeLogger } {
    const runtimeLogger = this.config.runtime?.logger ?? consola.withTag('FrpRuntime')
    const processLogger = this.config.process?.logger ?? consola.withTag('FrpProcessManager')

    return { runtimeLogger, processLogger }
  }

  /**
   * Create process manager
   */
  private createProcessManager(processDir: string, logger: RuntimeLogger): FrpProcessManager {
    return new FrpProcessManager({
      mode: this.config.process?.mode ?? this.config.mode,
      version: this.config.process?.version,
      workDir: processDir,
      configPath: this.config.configPath,
      logger
    })
  }

  /**
   * Create runtime context
   */
  private createRuntimeContext(runtimeDir: string, logger: RuntimeLogger): RuntimeContext {
    return {
      id: this.config.runtime?.id ?? 'default',
      mode: this.config.runtime?.mode ?? this.config.mode,
      workDir: runtimeDir,
      platform: this.config.runtime?.platform ?? process.platform,
      clock: this.config.runtime?.clock,
      logger
    }
  }

  /**
   * Create node manager (server mode only)
   */
  private createNodeManager(runtimeContext: RuntimeContext, runtimeDir: string, logger: RuntimeLogger): NodeManager | undefined {
    if (this.config.mode !== 'server') {
      return undefined
    }

    const nodeStorageDir = join(runtimeDir, 'nodes')
    ensureDir(nodeStorageDir)
    const nodeStorage = new FileNodeStorage(nodeStorageDir)

    return new NodeManager(runtimeContext, {
      heartbeatTimeout: 90000, // 90 seconds
      logger
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
      heartbeatInterval: 30000, // 30 seconds
      logger: consola.withTag('ClientNodeCollector')
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
        logger: consola.withTag('RpcServer')
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
        handleRequest: rpcOptions.handleRequest ?? (async () => undefined),
        logger: consola.withTag('RpcClient')
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

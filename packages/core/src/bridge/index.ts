import type { ClientNodeCollector, NodeManager } from '../node'

import type { FrpProcessManager } from '../process'
import type { RpcClient, RpcServer } from '../rpc'
import type { CommandHandler, FrpRuntime, QueryHandler, RuntimeCommand, RuntimeEvent, RuntimeQuery, RuntimeState, SnapshotStorage } from '../runtime'
import type { CommandDependencies } from './handlers/decorators'

import type { QueryDependencies } from './handlers/query-handlers'
import type { FrpBridgeProcessOptions, FrpBridgeRpcOptions, FrpBridgeRuntimeOptions } from './initializer'
import { join } from 'pathe'

import { FrpRuntime as Runtime } from '../runtime'
import { FileSnapshotStorage } from '../runtime/file-snapshot-storage'

import { createCommandHandlers } from './handlers/command-handlers'
import { createQueryHandlers } from './handlers/query-handlers'

import { FrpBridgeInitializer, setupProcessEventBridge } from './initializer'

// Re-export types for backward compatibility
export type { ConfigApplyPayload, ConfigApplyRawPayload, ProxyAddPayload, ProxyGetPayload, ProxyRemovePayload, ProxyUpdatePayload } from './types'

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

/**
 * FrpBridge - Main facade class for managing FRP bridge operations.
 *
 * This class serves as a facade that coordinates multiple components:
 * - Runtime management (command/query execution)
 * - Process management (FRP process lifecycle)
 * - Node management (server mode only)
 * - RPC communication
 *
 * Design patterns used:
 * - Facade Pattern: Simplifies interface to complex subsystems
 * - Dependency Injection: All dependencies injected via constructor
 * - Factory Pattern: Handlers created via factory functions
 */
export class FrpBridge {
  private readonly runtime: FrpRuntime
  private readonly process: FrpProcessManager
  private readonly mode: 'client' | 'server'
  private readonly eventSink?: (event: RuntimeEvent) => void
  private readonly nodeManager?: NodeManager
  private readonly clientCollector?: ClientNodeCollector
  private readonly rpcServer?: RpcServer
  private readonly rpcClient?: RpcClient

  constructor(options: FrpBridgeOptions) {
    this.mode = options.mode

    // Use initializer to setup all components
    const initializer = new FrpBridgeInitializer(options)
    const initResult = initializer.initialize()

    this.process = initResult.process
    this.nodeManager = initResult.nodeManager
    this.clientCollector = initResult.clientCollector
    this.rpcServer = initResult.rpcServer
    this.rpcClient = initResult.rpcClient

    // Create storage
    const storage = options.storage ?? new FileSnapshotStorage(join(initResult.runtimeDir, 'snapshots'))

    // Create runtime first
    this.runtime = new Runtime(initResult.runtimeContext, {
      storage,
      commands: {}, // Will be populated below
      queries: {} // Will be populated below
    })

    // Create handlers with dependencies
    const commandDeps: CommandDependencies = {
      process: this.process,
      nodeManager: this.nodeManager,
      rpcServer: this.rpcServer,
      mode: this.mode
    }

    const queryDeps: QueryDependencies = {
      process: this.process,
      nodeManager: this.nodeManager,
      runtime: this.runtime,
      mode: this.mode
    }

    const defaultCommands = createCommandHandlers(commandDeps)
    const defaultQueries = createQueryHandlers(queryDeps)

    // Merge with custom commands/queries
    const commands = {
      ...defaultCommands,
      ...(options.commands ?? {})
    }

    const queries = {
      ...defaultQueries,
      ...(options.queries ?? {})
    }

    // Register handlers in runtime
    Object.entries(commands).forEach(([name, handler]) => {
      this.runtime.registerCommand(name, handler)
    })
    Object.entries(queries).forEach(([name, handler]) => {
      this.runtime.registerQuery(name, handler)
    })

    this.eventSink = options.eventSink
    setupProcessEventBridge(this.process, this.eventSink)
  }

  /**
   * Execute a command
   */
  execute<TPayload, TResult = unknown>(command: RuntimeCommand<TPayload>): Promise<import('../runtime').CommandResult<TResult>> {
    return this.runtime.execute<TPayload, TResult>(command).finally(() => {
      this.forwardEvents()
    })
  }

  /**
   * Execute a query
   */
  query<TPayload, TResult = unknown>(query: RuntimeQuery<TPayload>): Promise<import('../runtime').QueryResult<TResult>> {
    return this.runtime.query<TPayload, TResult>(query).finally(() => {
      this.forwardEvents()
    })
  }

  /**
   * Get current runtime state snapshot
   */
  snapshot(): RuntimeState {
    return this.runtime.snapshot()
  }

  /**
   * Drain and return all pending events
   */
  drainEvents(): RuntimeEvent[] {
    return this.runtime.drainEvents()
  }

  // Getters for managed components

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

  /**
   * Initialize all async components
   */
  async initialize(): Promise<void> {
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

  /**
   * Cleanup and dispose all resources
   */
  async dispose(): Promise<void> {
    if (this.nodeManager) {
      this.nodeManager.dispose()
    }

    if (this.clientCollector) {
      this.clientCollector.stopHeartbeat()
    }

    if (this.rpcServer) {
      this.rpcServer.stop()
    }

    if (this.rpcClient) {
      this.rpcClient.disconnect()
    }

    // Dispose process manager and clean up event listeners
    await this.process.dispose()
  }

  /**
   * Forward runtime events to external event sink
   */
  private forwardEvents(): void {
    if (!this.eventSink) {
      return
    }

    const events = this.runtime.drainEvents()
    events.forEach(event => this.eventSink?.(event))
  }
}

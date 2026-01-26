/**
 * FRP process management utilities
 *
 * This class serves as a facade that delegates to specialized components:
 * - ProcessController: Process lifecycle management
 * - ConfigurationStore: Configuration file operations
 * - TunnelManager: Tunnel/proxy management
 * - NodeManager: Node information management
 * - BinaryManager: Binary file management
 */

import type { ClientConfig, ProxyConfig, ServerConfig } from '@frp-bridge/types'
import type { ChildProcess } from 'node:child_process'
import type { RuntimeLogger } from '../runtime'
import type { NodeInfo as NewNodeInfo, ProcessControllerEvent } from './controllers'
import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import { consola } from 'consola'
import { join } from 'pathe'
import { ConfigNotFoundError, ModeError } from '../errors'

// Import refactored components
import {
  BinaryManager,
  ConfigurationStore,
  NodeManager,
  ProcessController,
  TunnelManager
} from './controllers'

export interface ProcessEvent {
  type: 'process:started' | 'process:stopped' | 'process:exited' | 'process:error'
  timestamp: number
  payload?: {
    code?: number
    signal?: string
    error?: string
    pid?: number
    uptime?: number
  }
}

export interface FrpProcessManagerOptions {
  /** Working directory for FRP files */
  workDir?: string
  /** Path to config file (overrides default) */
  configPath?: string
  /** FRP version (defaults to latest) */
  version?: string
  /** Mode: client or server */
  mode: 'client' | 'server'
  /** Optional logger */
  logger?: RuntimeLogger
}

export interface NodeInfo {
  /** Node ID */
  id: string
  /** Node name */
  name: string
  /** Server address */
  serverAddr: string
  /** Server port */
  serverPort?: number
  /** Authentication token */
  token?: string
  /** Additional config */
  config?: Partial<ClientConfig | ServerConfig>
}

/**
 * Manages FRP client/server lifecycle, config, and tunnels
 *
 * This class now serves as a facade that delegates to specialized components:
 * - ProcessController: Process lifecycle management
 * - ConfigurationStore: Configuration file operations
 * - TunnelManager: Tunnel/proxy management
 * - NodeManager: Node information management
 * - BinaryManager: Binary file management
 */
export class FrpProcessManager extends EventEmitter {
  private readonly workDir: string
  private readonly mode: 'client' | 'server'
  private readonly specifiedVersion?: string
  private readonly logger: RuntimeLogger
  private readonly configPath: string

  // Component instances
  private readonly processController: ProcessController
  private readonly configStore: ConfigurationStore
  private readonly binaryManager: BinaryManager
  private tunnelManager: TunnelManager | null = null
  private nodeManager: NodeManager | null = null

  // Process state tracking
  private process: ChildProcess | null = null
  private uptime: number | null = null
  private isManualStop = false

  constructor(options: FrpProcessManagerOptions) {
    super()
    this.mode = options.mode
    this.specifiedVersion = options.version
    this.workDir = options.workDir || join(homedir(), '.frp-bridge')
    this.configPath = options.configPath || join(this.workDir, `frp${this.mode === 'client' ? 'c' : 's'}.toml`)
    this.logger = options.logger ?? consola.withTag('FrpProcessManager')

    // Initialize components
    this.configStore = new ConfigurationStore({ logger: this.logger })
    this.processController = new ProcessController({ logger: this.logger })
    this.binaryManager = new BinaryManager({
      workDir: this.workDir,
      mode: this.mode,
      logger: this.logger
    })

    // Initialize conditional components
    if (this.mode === 'client') {
      this.tunnelManager = new TunnelManager({
        configStore: this.configStore,
        configPath: this.configPath,
        logger: this.logger
      })

      this.nodeManager = new NodeManager({
        configStore: this.configStore,
        configPath: this.configPath,
        logger: this.logger
      })
    }

    // Forward process controller events
    this.processController.on('process:started', (event: ProcessControllerEvent) => {
      this.emit(event.type, event as ProcessEvent)
    })

    this.processController.on('process:stopped', (event: ProcessControllerEvent) => {
      this.emit(event.type, event as ProcessEvent)
    })

    this.processController.on('process:exited', (event: ProcessControllerEvent) => {
      this.emit(event.type, event as ProcessEvent)
    })

    this.processController.on('process:error', (event: ProcessControllerEvent) => {
      this.emit(event.type, event as ProcessEvent)
    })
  }

  /** Ensure version is fetched and binary path is set */
  private async ensureVersion(): Promise<string> {
    const binaryPath = await this.binaryManager.ensureInstalled(this.specifiedVersion)
    return binaryPath
  }

  /** Download FRP binary for current platform */
  async downloadFrpBinary(): Promise<void> {
    await this.binaryManager.download()
  }

  /** Update FRP binary to latest version */
  async updateFrpBinary(newVersion?: string): Promise<void> {
    const targetVersion = newVersion || await this.binaryManager.getLatest()
    await this.binaryManager.update(targetVersion)
  }

  /** Check if binary exists */
  hasBinary(): boolean {
    return this.binaryManager.hasBinary()
  }

  /** Get current configuration */
  async getConfig(): Promise<ClientConfig | ServerConfig | null> {
    if (!this.configStore.exists(this.configPath)) {
      return null
    }
    return this.configStore.load(this.configPath) as Promise<ClientConfig | ServerConfig | null>
  }

  /** Update configuration */
  async updateConfig(config: Partial<ClientConfig | ServerConfig>): Promise<void> {
    const current = await this.getConfig()
    const merged = this.configStore.merge(current || {}, config)
    await this.configStore.save(this.configPath, merged)
  }

  /** Backup configuration */
  async backupConfig(): Promise<string> {
    if (!this.configStore.exists(this.configPath)) {
      throw new ConfigNotFoundError('Config file does not exist')
    }

    const timestamp = Date.now()
    const backupPath = `${this.configPath}.${timestamp}.bak`

    const fs = await import('fs-extra')
    await fs.copy(this.configPath, backupPath)

    return backupPath
  }

  /** Return the absolute config file path */
  getConfigPath(): string {
    return this.configPath
  }

  /** Read raw config file contents */
  getConfigRaw(): string | null {
    return this.configStore.getRaw(this.configPath)
  }

  /** Overwrite config file with provided content */
  updateConfigRaw(content: string): void {
    this.configStore.writeRaw(this.configPath, content)
  }

  /** Start FRP process */
  async start(): Promise<void> {
    const binaryPath = await this.ensureVersion()

    // Kill existing process if it's still running
    if (this.isRunning()) {
      await this.stop()
    }

    if (!this.hasBinary()) {
      await this.downloadFrpBinary()
    }

    if (!this.configStore.exists(this.configPath)) {
      throw new ConfigNotFoundError('Config file does not exist')
    }

    // Use ProcessController to start the process
    await this.processController.start(binaryPath, this.configPath)

    // Update process state for queryProcess()
    const status = this.processController.getStatus()
    if (status) {
      this.uptime = status.startTime
      this.process = {
        pid: status.pid,
        exitCode: status.exitCode,
        signalCode: status.signal,
        kill: () => {
          // No-op - process is managed by ProcessController
        }
      } as ChildProcess
    }
  }

  /** Stop FRP process */
  async stop(): Promise<void> {
    if (!this.processController.isRunning()) {
      return
    }

    this.isManualStop = true

    await this.processController.stop()

    // Clear process state
    this.uptime = null
    this.process = null
  }

  /** Check if process is running */
  isRunning(): boolean {
    return this.processController.isRunning()
  }

  /** Add node (for client mode) */
  async addNode(node: NodeInfo): Promise<void> {
    if (!this.nodeManager) {
      throw new ModeError('Nodes can only be added in client mode')
    }

    await this.nodeManager.setNode(node as NewNodeInfo)
  }

  /** Get node info */
  async getNode(): Promise<NodeInfo | null> {
    if (!this.nodeManager) {
      throw new ModeError('Nodes are only available in client mode')
    }

    return this.nodeManager.getNode() as Promise<NodeInfo | null>
  }

  /** Update node info */
  async updateNode(node: Partial<NodeInfo>): Promise<void> {
    if (!this.nodeManager) {
      throw new ModeError('Nodes can only be updated in client mode')
    }

    await this.nodeManager.updateNode(node as Partial<NewNodeInfo>)
  }

  /** Remove node */
  async removeNode(): Promise<void> {
    if (!this.nodeManager) {
      throw new ModeError('Nodes can only be removed in client mode')
    }

    await this.nodeManager.clearNode()
  }

  /** Add tunnel (proxy) */
  async addTunnel(proxy: ProxyConfig): Promise<void> {
    if (!this.tunnelManager) {
      throw new ModeError('Tunnels can only be added in client mode')
    }

    await this.tunnelManager.add(proxy)
  }

  /** Get tunnel by name */
  async getTunnel(name: string): Promise<ProxyConfig | null> {
    if (!this.tunnelManager) {
      throw new ModeError('Tunnels are only available in client mode')
    }

    return this.tunnelManager.get(name)
  }

  /** Update tunnel */
  async updateTunnel(name: string, proxy: Partial<ProxyConfig>): Promise<void> {
    if (!this.tunnelManager) {
      throw new ModeError('Tunnels can only be updated in client mode')
    }

    await this.tunnelManager.update(name, proxy)
  }

  /** Remove tunnel */
  async removeTunnel(name: string): Promise<void> {
    if (!this.tunnelManager) {
      throw new ModeError('Tunnels can only be removed in client mode')
    }

    await this.tunnelManager.remove(name)
  }

  /** List all tunnels */
  async listTunnels(): Promise<ProxyConfig[]> {
    if (!this.tunnelManager) {
      throw new ModeError('Tunnels are only available in client mode')
    }

    return this.tunnelManager.list()
  }

  /**
   * Query current process status
   */
  queryProcess() {
    const uptime = this.uptime ? Date.now() - this.uptime : 0
    const status = this.processController.getStatus()

    return {
      pid: status?.pid ?? this.process?.pid,
      uptime
    }
  }
}

// Re-export all controllers from './controllers'
export * from './controllers'

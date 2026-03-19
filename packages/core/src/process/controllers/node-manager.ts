/**
 * NodeManager - FRP 服务器节点信息的管理（Client 模式）
 * 负责节点信息的独立管理，与隧道配置分离
 */

import type { ClientConfig } from '@frp-bridge/types'
import type { RuntimeLogger } from '../../runtime'
import type { ConfigurationStore } from './configuration-store'
import { createLogger } from '@frp-bridge/shared'

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
  config?: Partial<ClientConfig>
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export interface NodeManagerOptions {
  /** Configuration store for reading/writing */
  configStore: ConfigurationStore
  /** Config file path */
  configPath: string
  /** Optional logger */
  logger?: Partial<RuntimeLogger>
}

/**
 * NodeManager 管理 FRP 服务器节点信息
 */
export class NodeManager {
  private readonly configStore: ConfigurationStore
  private readonly configPath: string
  private readonly log = createLogger('Node')

  constructor(options: NodeManagerOptions) {
    this.configStore = options.configStore
    this.configPath = options.configPath
  }

  /**
   * Set node information
   */
  async setNode(node: NodeInfo): Promise<void> {
    const config = (await this.loadConfig()) || {}

    config.serverAddr = node.serverAddr
    config.serverPort = node.serverPort ?? 7000

    if (node.token) {
      config.auth = { ...config.auth, token: node.token }
    }

    if (node.config) {
      Object.assign(config, node.config)
    }

    await this.configStore.save(this.configPath, config)

    this.log.success('Node configured', { serverAddr: node.serverAddr, serverPort: node.serverPort ?? 7000 })
  }

  /**
   * Get node information
   */
  async getNode(): Promise<NodeInfo | null> {
    const config = await this.loadConfig()
    if (!config || !config.serverAddr) {
      this.log.debug('Node not configured')
      return null
    }

    return {
      id: 'default',
      name: 'default',
      serverAddr: config.serverAddr,
      serverPort: config.serverPort,
      token: config.auth?.token
    }
  }

  /**
   * Update node information
   */
  async updateNode(updates: Partial<NodeInfo>): Promise<void> {
    const config = (await this.loadConfig()) || {}

    if (updates.serverAddr) {
      config.serverAddr = updates.serverAddr
    }

    if (updates.serverPort) {
      config.serverPort = updates.serverPort
    }

    if (updates.token) {
      config.auth = { ...config.auth, token: updates.token }
    }

    if (updates.config) {
      Object.assign(config, updates.config)
    }

    await this.configStore.save(this.configPath, config)

    this.log.success('Node updated', { updates: Object.keys(updates) })
  }

  /**
   * Clear node information (remove config file)
   */
  async clearNode(): Promise<void> {
    // Import dynamically to avoid issues
    const { unlinkSync } = await import('node:fs')
    const { existsSync } = await import('node:fs')

    if (existsSync(this.configPath)) {
      unlinkSync(this.configPath)
      this.log.success('Node configuration cleared')
    }
    else {
      this.log.debug('No node configuration to clear')
    }
  }

  /**
   * Validate node information
   */
  validateNode(node: NodeInfo): ValidationResult {
    const errors: string[] = []

    if (!node.serverAddr) {
      errors.push('Server address is required')
    }

    if (node.serverPort !== undefined) {
      if (node.serverPort < 1 || node.serverPort > 65535) {
        errors.push('Server port must be between 1-65535')
      }
    }

    const valid = errors.length === 0
    if (!valid) {
      this.log.warn('Node validation failed', { errors })
    }
    else {
      this.log.debug('Node validation passed', { serverAddr: node.serverAddr })
    }

    return { valid, errors }
  }

  /**
   * Load config with caching
   */
  private async loadConfig(): Promise<ClientConfig | null> {
    if (!this.configStore.exists(this.configPath)) {
      return null
    }
    return this.configStore.load(this.configPath) as Promise<ClientConfig | null>
  }
}

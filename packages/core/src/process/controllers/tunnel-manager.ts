/**
 * TunnelManager - 隧道（Proxy）配置的增删改查和验证
 * 负责隧道配置的管理，包括名称唯一性校验、端口冲突检测
 */

import type { ProxyConfig } from '@frp-bridge/types'
import type { RuntimeLogger } from '../../runtime'
import type { ConfigurationStore, FrpConfig } from './configuration-store'
import { ConfigInvalidError, NotFoundError } from '../../errors'
import { createLogger } from '../../logging'
import { typeUsesRemotePort } from '../../utils'

/**
 * Extended config type that includes proxies array
 * This represents the actual TOML structure with [[proxies]] syntax
 */
type ExtendedFrpConfig = FrpConfig & { proxies?: ProxyConfig[] }

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export interface TunnelManagerOptions {
  /** Configuration store for reading/writing */
  configStore: ConfigurationStore
  /** Config file path */
  configPath: string
  /** Optional logger */
  logger?: RuntimeLogger
}

/**
 * TunnelManager 管理隧道配置
 */
export class TunnelManager {
  private readonly configStore: ConfigurationStore
  private readonly configPath: string
  private readonly logger: RuntimeLogger
  private readonly log = createLogger('Tunnel')

  constructor(options: TunnelManagerOptions) {
    this.configStore = options.configStore
    this.configPath = options.configPath
    this.logger = options.logger ?? console
  }

  /**
   * Add a tunnel/proxy configuration
   */
  async add(proxy: ProxyConfig): Promise<void> {
    // 1. Load current config
    const config = await this.loadConfig()
    const parsed = (config || {}) as Record<string, unknown>

    // 2. Ensure proxies array exists
    if (!Array.isArray(parsed.proxies)) {
      parsed.proxies = []
    }

    // 3. Validate uniqueness
    this.validateUniqueness(parsed, proxy)

    // 4. Add to array
    ;(parsed.proxies as ProxyConfig[]).push(proxy)

    // 5. Save
    await this.configStore.save(this.configPath, parsed as FrpConfig)

    this.log.success('Tunnel added', { name: proxy.name, type: proxy.type })
  }

  /**
   * Get a tunnel by name
   */
  async get(name: string): Promise<ProxyConfig | null> {
    const config = await this.loadConfig() as ExtendedFrpConfig | null
    if (!config) {
      this.log.debug('Tunnel not found: config is empty', { name })
      return null
    }

    // Handle [[proxies]] array syntax
    if (Array.isArray(config.proxies)) {
      const tunnel = config.proxies.find(p => p && p.name === name) || null
      if (!tunnel) {
        this.log.debug('Tunnel not found in proxies array', { name })
      }
      return tunnel
    }

    // Handle legacy format
    return (config as Record<string, unknown>)[name] as ProxyConfig || null
  }

  /**
   * Update a tunnel
   */
  async update(name: string, proxy: Partial<ProxyConfig>): Promise<void> {
    const config = await this.loadConfig() as ExtendedFrpConfig | null
    if (!config) {
      throw new NotFoundError(`Tunnel ${name} not found`)
    }

    // Handle [[proxies]] array syntax
    if (Array.isArray(config.proxies)) {
      const tunnelIndex = config.proxies.findIndex(p => p && p.name === name)
      if (tunnelIndex === -1) {
        throw new NotFoundError(`Tunnel ${name} not found`)
      }

      const existingTunnel = config.proxies[tunnelIndex]
      const updatedTunnel = { ...existingTunnel, ...proxy }

      // Check remotePort conflict if changed
      const newRemotePort = proxy.remotePort
      if (newRemotePort && newRemotePort !== existingTunnel.remotePort) {
        this.validateRemotePort(config.proxies, newRemotePort, updatedTunnel.type, tunnelIndex)
      }

      config.proxies[tunnelIndex] = updatedTunnel
    }
    // Handle legacy format
    else if ((config as Record<string, unknown>)[name]) {
      const existing = (config as Record<string, unknown>)[name] as ProxyConfig
      ;(config as Record<string, unknown>)[name] = { ...existing, ...proxy }
    }
    else {
      throw new NotFoundError(`Tunnel ${name} not found`)
    }

    await this.configStore.save(this.configPath, config as FrpConfig)

    this.log.success('Tunnel updated', { name, changes: Object.keys(proxy) })
  }

  /**
   * Remove a tunnel
   */
  async remove(name: string): Promise<void> {
    const config = await this.loadConfig() as ExtendedFrpConfig | null
    if (!config) {
      this.log.debug('Cannot remove tunnel: config is empty', { name })
      return
    }

    let modified = false

    // Handle [[proxies]] array syntax
    if (Array.isArray(config.proxies)) {
      const tunnelIndex = config.proxies.findIndex(p => p && p.name === name)
      if (tunnelIndex !== -1) {
        config.proxies.splice(tunnelIndex, 1)
        modified = true
        this.log.success('Tunnel removed', { name })
      }
      else {
        this.log.debug('Tunnel not found for removal', { name })
      }
    }
    // Handle legacy format
    else if ((config as Record<string, unknown>)[name]) {
      delete (config as Record<string, unknown>)[name]
      modified = true
      this.log.success('Tunnel removed', { name })
    }
    else {
      this.log.debug('Tunnel not found for removal', { name })
    }

    if (modified) {
      await this.configStore.save(this.configPath, config as FrpConfig)
    }
  }

  /**
   * List all tunnels
   */
  async list(): Promise<ProxyConfig[]> {
    const config = await this.loadConfig() as ExtendedFrpConfig | null
    if (!config) {
      this.log.debug('List tunnels: config is empty')
      return []
    }

    const tunnels: ProxyConfig[] = []

    // Handle [[proxies]] array syntax
    if (Array.isArray(config.proxies)) {
      for (const proxy of config.proxies) {
        if (proxy && typeof proxy === 'object' && 'type' in proxy) {
          tunnels.push(proxy as ProxyConfig)
        }
      }
    }

    // Handle legacy format
    const proxyKeys = new Set(tunnels.map(t => t.name))
    for (const [key, value] of Object.entries(config)) {
      if (key === 'proxies')
        continue
      if (typeof value === 'object' && value !== null && 'type' in value && !Array.isArray(value)) {
        const proxy = { ...value, name: ((value as ProxyConfig).name) || key } as ProxyConfig
        if (!proxyKeys.has(proxy.name)) {
          tunnels.push(proxy)
          proxyKeys.add(proxy.name)
        }
      }
    }

    this.log.debug('Listed tunnels', { count: tunnels.length })
    return tunnels
  }

  /**
   * Check if tunnel exists
   */
  async exists(name: string): Promise<boolean> {
    const tunnel = await this.get(name)
    return tunnel !== null
  }

  /**
   * Validate tunnel configuration
   */
  validate(proxy: ProxyConfig): ValidationResult {
    const errors: string[] = []

    if (!proxy.name) {
      errors.push('Tunnel name is required')
    }

    if (!proxy.type) {
      errors.push('Tunnel type is required')
    }

    const valid = errors.length === 0
    if (valid) {
      this.log.debug('Tunnel validation passed', { name: proxy.name, type: proxy.type })
    }
    else {
      this.log.warn('Tunnel validation failed', { errors })
    }

    return { valid, errors }
  }

  /**
   * Load config with caching
   */
  private async loadConfig(): Promise<FrpConfig | null> {
    if (!this.configStore.exists(this.configPath)) {
      return null
    }
    return this.configStore.load(this.configPath)
  }

  /**
   * Validate tunnel uniqueness
   */
  private validateUniqueness(config: Record<string, unknown>, proxy: ProxyConfig): void {
    const proxies = (config.proxies as ProxyConfig[]) || []

    // Check name uniqueness
    const existingName = proxies.find(p => p && p.name === proxy.name)
    if (existingName) {
      this.log.warn('Tunnel name already exists', { name: proxy.name })
      throw new ConfigInvalidError(`Tunnel ${proxy.name} already exists`)
    }

    // Check remotePort conflict for types that use it
    const proxyRemotePort = proxy.remotePort
    if (proxyRemotePort && typeUsesRemotePort(proxy.type)) {
      this.validateRemotePort(proxies, proxyRemotePort, proxy.type)
    }

    this.log.debug('Tunnel uniqueness validation passed', { name: proxy.name })
  }

  /**
   * Validate remotePort conflict
   */
  private validateRemotePort(proxies: ProxyConfig[], remotePort: number, type: string, excludeIndex = -1): void {
    if (!typeUsesRemotePort(type)) {
      return
    }

    const inUse = proxies.some((p, idx) => {
      if (idx === excludeIndex)
        return false
      const pRemotePort = p.remotePort
      return p && pRemotePort === remotePort && typeUsesRemotePort(p.type)
    })

    if (inUse) {
      this.log.warn('Remote port already in use', { remotePort, type })
      throw new ConfigInvalidError(`Remote port ${remotePort} is already in use`)
    }

    this.log.debug('Remote port validation passed', { remotePort, type })
  }
}

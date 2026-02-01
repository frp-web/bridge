/**
 * TunnelManager - 隧道（Proxy）配置的增删改查和验证
 * 负责隧道配置的管理，包括名称唯一性校验、端口冲突检测
 */

import type { ProxyConfig } from '@frp-bridge/types'
import type { RuntimeLogger } from '../../runtime'
import type { ConfigurationStore, FrpConfig } from './configuration-store'
import { ProxyType } from '@frp-bridge/types'
import { ConfigInvalidError, NotFoundError } from '../../errors'

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
  }

  /**
   * Get a tunnel by name
   */
  async get(name: string): Promise<ProxyConfig | null> {
    const config = await this.loadConfig() as ExtendedFrpConfig | null
    if (!config) {
      return null
    }

    // Handle [[proxies]] array syntax
    if (Array.isArray(config.proxies)) {
      return config.proxies.find((p: any) => p && p.name === name) as ProxyConfig || null
    }

    // Handle legacy format
    return (config as any)[name] as ProxyConfig || null
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
      const tunnelIndex = config.proxies.findIndex((p: any) => p && p.name === name)
      if (tunnelIndex === -1) {
        throw new NotFoundError(`Tunnel ${name} not found`)
      }

      const existingTunnel = config.proxies[tunnelIndex]
      const updatedTunnel = { ...existingTunnel, ...proxy }

      // Check remotePort conflict if changed
      const newRemotePort = (proxy as any).remotePort
      if (newRemotePort && newRemotePort !== (existingTunnel as any).remotePort) {
        this.validateRemotePort(config.proxies, newRemotePort, (updatedTunnel as any).type, tunnelIndex)
      }

      config.proxies[tunnelIndex] = updatedTunnel
    }
    // Handle legacy format
    else if ((config as any)[name]) {
      ;(config as any)[name] = { ...(config as any)[name], ...proxy }
    }
    else {
      throw new NotFoundError(`Tunnel ${name} not found`)
    }

    await this.configStore.save(this.configPath, config as FrpConfig)
  }

  /**
   * Remove a tunnel
   */
  async remove(name: string): Promise<void> {
    const config = await this.loadConfig() as ExtendedFrpConfig | null
    if (!config) {
      return
    }

    let modified = false

    // Handle [[proxies]] array syntax
    if (Array.isArray(config.proxies)) {
      const tunnelIndex = config.proxies.findIndex((p: any) => p && p.name === name)
      if (tunnelIndex !== -1) {
        config.proxies.splice(tunnelIndex, 1)
        modified = true
      }
    }
    // Handle legacy format
    else if ((config as any)[name]) {
      delete (config as any)[name]
      modified = true
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
    const proxyKeys = new Set(tunnels.map((t: any) => t.name))
    for (const [key, value] of Object.entries(config)) {
      if (key === 'proxies')
        continue
      if (typeof value === 'object' && value !== null && 'type' in value && !Array.isArray(value)) {
        const proxy = { ...value, name: (value as any).name || key } as ProxyConfig
        if (!proxyKeys.has(proxy.name)) {
          tunnels.push(proxy)
          proxyKeys.add(proxy.name)
        }
      }
    }

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

    return { valid: errors.length === 0, errors }
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
  private validateUniqueness(config: any, proxy: ProxyConfig): void {
    const proxies = config.proxies || []

    // Check name uniqueness
    const existingName = proxies.find((p: any) => p && p.name === proxy.name)
    if (existingName) {
      throw new ConfigInvalidError(`Tunnel ${proxy.name} already exists`)
    }

    // Check remotePort conflict for types that use it
    const proxyRemotePort = (proxy as any).remotePort
    if (proxyRemotePort && this.typeUsesRemotePort(proxy.type)) {
      this.validateRemotePort(proxies, proxyRemotePort, proxy.type)
    }
  }

  /**
   * Validate remotePort conflict
   */
  private validateRemotePort(proxies: any[], remotePort: number, type: string, excludeIndex = -1): void {
    if (!this.typeUsesRemotePort(type)) {
      return
    }

    const inUse = proxies.some((p: any, idx: number) => {
      if (idx === excludeIndex)
        return false
      const pRemotePort = (p as any).remotePort
      return p && pRemotePort === remotePort && this.typeUsesRemotePort(p.type)
    })

    if (inUse) {
      throw new ConfigInvalidError(`Remote port ${remotePort} is already in use`)
    }
  }

  /**
   * Check if proxy type uses remotePort
   */
  private typeUsesRemotePort(type: string): boolean {
    return [
      ProxyType.TCP,
      ProxyType.UDP,
      ProxyType.STCP,
      ProxyType.XTCP,
      ProxyType.SUDP,
      ProxyType.TCPMUX
    ].includes(type as ProxyType)
  }
}

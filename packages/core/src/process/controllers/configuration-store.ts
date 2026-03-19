/**
 * ConfigurationStore - 配置文件的持久化、反序列化、验证
 * 负责配置文件的读写，不关心业务逻辑
 */

import type { ClientConfig, ServerConfig } from '@frp-bridge/types'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { configurationStoreLogger } from '@frp-bridge/shared'
import { ConfigInvalidError, ConfigNotFoundError } from '../../errors'
import { parse as parseToml, stringify as toToml } from '../../toml'

export interface CachedConfig {
  path: string
  config: ClientConfig | ServerConfig
  mtime: number
  cachedAt: number
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export interface ConfigChangeCallback {
  (config: ClientConfig | ServerConfig): void
}

export type FrpConfig = ClientConfig | ServerConfig

export interface ConfigurationStoreOptions {
  /** Cache TTL in milliseconds (default: 5000) */
  cacheTTL?: number
}

/**
 * ConfigurationStore 管理配置文件的读写
 */
export class ConfigurationStore {
  private readonly log = configurationStoreLogger
  private readonly cache: Map<string, CachedConfig> = new Map()
  private readonly cacheTTL: number

  constructor(options: ConfigurationStoreOptions = {}) {
    this.cacheTTL = options.cacheTTL ?? 5000
  }

  /**
   * Load configuration from file
   */
  async load(path: string): Promise<FrpConfig> {
    // 1. Check cache
    const cached = this.getFromCache(path)
    if (cached) {
      return cached
    }

    // 2. Read file
    if (!existsSync(path)) {
      throw new ConfigNotFoundError(`Config file not found: ${path}`)
    }

    const content = readFileSync(path, 'utf-8')
    const mtime = this.getFileMtime(path)

    // 3. Parse TOML
    let config: FrpConfig
    try {
      config = parseToml(content) as FrpConfig
    }
    catch (error) {
      throw new ConfigInvalidError(
        `Failed to parse config: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    // 4. Update cache
    this.setToCache(path, config, mtime)

    return config
  }

  /**
   * Save configuration to file
   */
  async save(path: string, config: FrpConfig): Promise<void> {
    // 1. Validate
    const validation = this.validate(config)
    if (!validation.valid) {
      throw new ConfigInvalidError(
        `Config validation failed: ${validation.errors.join(', ')}`
      )
    }

    // 2. Serialize
    const content = toToml(config)

    // 3. Atomic write via temp file
    const tmpPath = `${path}.tmp`
    this.ensureDirectory(path)

    writeFileSync(tmpPath, content, 'utf-8')

    try {
      // 4. Atomic rename
      renameSync(tmpPath, path)

      // 5. Update cache
      const mtime = this.getFileMtime(path)
      this.setToCache(path, config, mtime)
    }
    catch (error) {
      // Cleanup temp file on failure
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath)
      }
      throw error
    }
  }

  /**
   * Merge two configurations
   */
  merge(base: FrpConfig, override: Partial<FrpConfig>): FrpConfig {
    const merged: Record<string, unknown> = { ...base as Record<string, unknown> }

    for (const key of Object.keys(override)) {
      const value = (override as Record<string, unknown>)[key]

      // Deep merge auth object
      if (key === 'auth') {
        merged[key] = { ...(base.auth as Record<string, unknown> | undefined), ...(value as Record<string, unknown>) }
      }
      // Replace arrays and other values
      else {
        merged[key] = value ?? (base as Record<string, unknown>)[key]
      }
    }

    return merged as FrpConfig
  }

  /**
   * Validate configuration
   */
  validate(config: FrpConfig): ValidationResult {
    const errors: string[] = []

    // Basic validation
    if (!config || typeof config !== 'object') {
      errors.push('Config must be an object')
      return { valid: false, errors }
    }

    return { valid: errors.length === 0, errors }
  }

  /**
   * Check if config file exists
   */
  exists(path: string): boolean {
    return existsSync(path)
  }

  /**
   * Get raw config content
   */
  getRaw(path: string): string | null {
    if (!existsSync(path)) {
      return null
    }
    return readFileSync(path, 'utf-8')
  }

  /**
   * Write raw content to config file
   */
  writeRaw(path: string, content: string): void {
    this.ensureDirectory(path)
    writeFileSync(path, content, 'utf-8')
    this.invalidateCache(path)
  }

  /**
   * Invalidate cache for a specific path
   */
  invalidateCache(path: string): void {
    this.cache.delete(path)
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  private getFromCache(path: string): FrpConfig | null {
    const cached = this.cache.get(path)
    if (!cached) {
      return null
    }

    const now = Date.now()
    const fileMtime = this.getFileMtime(path)

    // Check if cache is still valid
    if (cached.mtime === fileMtime && (now - cached.cachedAt) < this.cacheTTL) {
      return cached.config
    }

    // Cache expired or file changed
    this.cache.delete(path)
    return null
  }

  private setToCache(path: string, config: FrpConfig, mtime: number): void {
    this.cache.set(path, {
      path,
      config,
      mtime,
      cachedAt: Date.now()
    })
  }

  private getFileMtime(path: string): number {
    try {
      return statSync(path).mtimeMs
    }
    catch {
      return 0
    }
  }

  private ensureDirectory(path: string): void {
    const dir = path.substring(0, Math.max(
      path.lastIndexOf('/'),
      path.lastIndexOf('\\')
    ))
    if (dir && dir !== path && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }
}

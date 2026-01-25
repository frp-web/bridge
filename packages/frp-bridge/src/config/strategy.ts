/**
 * 配置合并策略模式
 * 为不同类型的 FRP 配置提供统一的合并接口
 */

import type { PresetConfig } from '../preset-config'

/**
 * 配置合并策略接口
 */
export interface ConfigMergeStrategy {
  /**
   * 合并预设配置和用户配置
   */
  merge: (presetConfig: PresetConfig, userConfig: string) => string

  /**
   * 验证配置
   */
  validate?: (config: PresetConfig) => { valid: boolean, errors: string[] }
}

/**
 * TOML 构建器
 * 使用构建器模式生成 TOML 配置
 */
export class TomlBuilder {
  private lines: string[] = []

  /**
   * 添加键值对
   */
  addKeyValue(key: string, value: string | number | boolean): this {
    if (typeof value === 'string') {
      this.lines.push(`${key} = "${value}"`)
    }
    else {
      this.lines.push(`${key} = ${value}`)
    }
    return this
  }

  /**
   * 添加嵌套键值对 (如 auth.token)
   */
  addNestedKeyValue(prefix: string, key: string, value: string): this {
    this.lines.push(`${prefix}.${key} = "${value}"`)
    return this
  }

  /**
   * 添加空行
   */
  addEmptyLine(): this {
    this.lines.push('')
    return this
  }

  /**
   * 添加节
   */
  addSection(name: string): this {
    this.lines.push(`[${name}]`)
    return this
  }

  /**
   * 添加多行内容
   */
  addLines(lines: string[]): this {
    this.lines.push(...lines)
    return this
  }

  /**
   * 构建最终的 TOML 字符串
   */
  build(): string {
    return this.lines.join('\n')
  }

  /**
   * 清空构建器
   */
  clear(): this {
    this.lines = []
    return this
  }

  /**
   * 获取当前行数
   */
  getLineCount(): number {
    return this.lines.length
  }
}

/**
 * FRPS 配置合并策略
 */
export class FrpsConfigStrategy implements ConfigMergeStrategy {
  merge(presetConfig: PresetConfig, userConfig: string): string {
    const frpsConfig = presetConfig.frps
    if (!frpsConfig) {
      return userConfig
    }

    const builder = new TomlBuilder()

    // 添加基础配置
    if (frpsConfig.bindPort) {
      builder.addKeyValue('bindPort', frpsConfig.bindPort)
    }

    if (frpsConfig.vhostHTTPPort) {
      builder.addKeyValue('vhostHTTPPort', frpsConfig.vhostHTTPPort)
    }

    // 添加仪表板配置
    if (frpsConfig.dashboardPort) {
      builder.addEmptyLine()
      builder.addSection('webServer')
      builder.addKeyValue('addr', '0.0.0.0')
      builder.addKeyValue('port', frpsConfig.dashboardPort)

      if (frpsConfig.dashboardUser) {
        builder.addKeyValue('user', frpsConfig.dashboardUser)
      }

      if (frpsConfig.dashboardPassword) {
        builder.addKeyValue('password', frpsConfig.dashboardPassword)
      }
    }

    // 添加用户配置中的代理部分
    const proxiesSection = this.extractProxiesSection(userConfig)
    if (proxiesSection.length > 0) {
      builder.addEmptyLine()
      builder.addLines(proxiesSection)
    }

    return builder.build()
  }

  validate(config: PresetConfig): { valid: boolean, errors: string[] } {
    const errors: string[] = []
    const frpsConfig = config.frps

    if (!frpsConfig) {
      return { valid: true, errors: [] }
    }

    if (frpsConfig.bindPort !== undefined) {
      if (frpsConfig.bindPort < 1 || frpsConfig.bindPort > 65535) {
        errors.push('bindPort must be between 1-65535')
      }
    }

    if (frpsConfig.vhostHTTPPort !== undefined) {
      if (frpsConfig.vhostHTTPPort < 1 || frpsConfig.vhostHTTPPort > 65535) {
        errors.push('vhostHTTPPort must be between 1-65535')
      }
    }

    if (frpsConfig.dashboardPort !== undefined) {
      if (frpsConfig.dashboardPort < 1 || frpsConfig.dashboardPort > 65535) {
        errors.push('dashboardPort must be between 1-65535')
      }
    }

    if (frpsConfig.domain !== undefined && !frpsConfig.domain) {
      errors.push('domain cannot be empty')
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }

  /**
   * 从用户配置中提取代理部分
   */
  private extractProxiesSection(userConfig: string): string[] {
    const lines = userConfig.split('\n')
    const proxiesSection: string[] = []
    let inProxies = false

    for (const line of lines) {
      if (line.trim().startsWith('[[proxies]]')) {
        inProxies = true
      }

      if (inProxies) {
        proxiesSection.push(line)
      }
    }

    return proxiesSection
  }
}

/**
 * FRPC 配置合并策略
 */
export class FrpcConfigStrategy implements ConfigMergeStrategy {
  merge(presetConfig: PresetConfig, userConfig: string): string {
    const frpcConfig = presetConfig.frpc
    if (!frpcConfig) {
      return userConfig
    }

    const builder = new TomlBuilder()

    // 添加服务器配置
    if (frpcConfig.serverAddr) {
      builder.addKeyValue('serverAddr', frpcConfig.serverAddr)
    }

    if (frpcConfig.serverPort) {
      builder.addKeyValue('serverPort', frpcConfig.serverPort)
    }

    if (frpcConfig.authToken) {
      builder.addNestedKeyValue('auth', 'token', frpcConfig.authToken)
    }

    // 添加用户配置中的代理部分
    const proxiesSection = this.extractProxiesSection(userConfig)
    if (proxiesSection.length > 0) {
      builder.addEmptyLine()
      builder.addLines(proxiesSection)
    }

    return builder.build()
  }

  validate(config: PresetConfig): { valid: boolean, errors: string[] } {
    const errors: string[] = []
    const frpcConfig = config.frpc

    if (!frpcConfig) {
      return { valid: true, errors: [] }
    }

    if (frpcConfig.serverPort !== undefined) {
      if (frpcConfig.serverPort < 1 || frpcConfig.serverPort > 65535) {
        errors.push('serverPort must be between 1-65535')
      }
    }

    if (frpcConfig.serverAddr !== undefined && !frpcConfig.serverAddr) {
      errors.push('serverAddr cannot be empty')
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }

  /**
   * 从用户配置中提取代理部分
   */
  private extractProxiesSection(userConfig: string): string[] {
    const lines = userConfig.split('\n')
    const proxiesSection: string[] = []
    let inProxies = false

    for (const line of lines) {
      if (line.trim().startsWith('[[proxies]]')) {
        inProxies = true
      }

      if (inProxies) {
        proxiesSection.push(line)
      }
    }

    return proxiesSection
  }
}

/**
 * 策略工厂
 * 根据配置类型创建相应的策略
 */
export class ConfigStrategyFactory {
  private static strategies = new Map<string, ConfigMergeStrategy>([
    ['frps', new FrpsConfigStrategy()],
    ['frpc', new FrpcConfigStrategy()]
  ])

  /**
   * 获取指定类型的策略
   */
  static getStrategy(type: 'frps' | 'frpc'): ConfigMergeStrategy {
    const strategy = this.strategies.get(type)
    if (!strategy) {
      throw new Error(`Unknown config type: ${type}`)
    }
    return strategy
  }

  /**
   * 注册自定义策略
   */
  static registerStrategy(type: string, strategy: ConfigMergeStrategy): void {
    this.strategies.set(type, strategy)
  }
}

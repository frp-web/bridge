/**
 * 配置合并方法 - core 包内部使用
 * 将预设配置和用户配置合并成最终的 frp 配置
 */

import type { ProxyConfig } from '@frp-bridge/types'
import { writeFileSync } from 'node:fs'

import { stringify as toToml } from './toml'
import { ensureDir } from './utils'

/**
 * 预设配置接口
 */
export interface PresetConfig {
  frps?: FrpsPresetConfig
  frpc?: FrpcPresetConfig
}

export interface FrpsPresetConfig {
  bindPort?: number
  vhostHTTPPort?: number
  vhostHTTPSPort?: number
  domain?: string
  dashboardPort?: number
  dashboardUser?: string
  dashboardPassword?: string
  authToken?: string
  subdomainHost?: string
}

export interface FrpcPresetConfig {
  serverAddr?: string
  serverPort?: number
  authToken?: string
  user?: string
  heartbeatInterval?: number
}

/**
 * 默认预设配置
 */
export const DEFAULT_PRESET_CONFIG: PresetConfig = {
  frps: {
    bindPort: 7000,
    vhostHTTPPort: 7000,
    vhostHTTPSPort: 443,
    dashboardPort: 7500,
    dashboardUser: 'admin',
    dashboardPassword: 'admin'
  },
  frpc: {
    serverPort: 7000
  }
}

/**
 * 合并预设配置和用户配置，生成最终的 TOML 配置
 */
export function mergeConfigs(
  presetConfig: PresetConfig,
  userConfig: string,
  type: 'frps' | 'frpc'
): string {
  const parts: string[] = []
  const config = type === 'frps' ? presetConfig.frps : presetConfig.frpc

  if (!config) {
    return userConfig
  }

  // 1. 添加基础配置
  const baseConfig: Record<string, any> = {}

  if (type === 'frps') {
    const frpsConfig = config as FrpsPresetConfig
    if (frpsConfig.bindPort)
      baseConfig.bindPort = frpsConfig.bindPort
    if (frpsConfig.vhostHTTPPort)
      baseConfig.vhostHTTPPort = frpsConfig.vhostHTTPPort
    if (frpsConfig.vhostHTTPSPort)
      baseConfig.vhostHTTPSPort = frpsConfig.vhostHTTPSPort
    if (frpsConfig.domain)
      baseConfig.domain = frpsConfig.domain
    if (frpsConfig.subdomainHost)
      baseConfig.subdomainHost = frpsConfig.subdomainHost

    // Dashboard 配置
    if (frpsConfig.dashboardPort || frpsConfig.dashboardUser || frpsConfig.dashboardPassword) {
      const webServer: Record<string, any> = {}
      if (frpsConfig.dashboardPort)
        webServer.addr = `0.0.0.0:${frpsConfig.dashboardPort}`
      if (frpsConfig.dashboardUser)
        webServer.user = frpsConfig.dashboardUser
      if (frpsConfig.dashboardPassword)
        webServer.password = frpsConfig.dashboardPassword
      baseConfig.webServer = webServer
    }

    if (frpsConfig.authToken)
      baseConfig.auth = { token: frpsConfig.authToken }
  }
  else {
    const frpcConfig = config as FrpcPresetConfig
    if (frpcConfig.serverAddr)
      baseConfig.serverAddr = frpcConfig.serverAddr
    if (frpcConfig.serverPort)
      baseConfig.serverPort = frpcConfig.serverPort
    if (frpcConfig.user)
      baseConfig.user = frpcConfig.user
    if (frpcConfig.heartbeatInterval)
      baseConfig.heartbeatInterval = frpcConfig.heartbeatInterval

    // Auth token (nested)
    if (frpcConfig.authToken) {
      baseConfig.auth = { token: frpcConfig.authToken }
    }
  }

  // 2. 转换为 TOML
  parts.push(objectToToml(baseConfig, ''))

  // 3. 添加用户配置
  if (userConfig.trim()) {
    parts.push(userConfig.trim())
  }

  return parts.filter(Boolean).join('\n')
}

/**
 * 从 tunnels 数组生成并保存 FRP 配置文件
 */
export function saveFrpConfigFile(
  configPath: string,
  tunnels: ProxyConfig[],
  presetConfig: PresetConfig,
  type: 'frps' | 'frpc'
): void {
  // 1. 将 tunnels 转换为 TOML 格式
  const userConfig = tunnelsToToml(tunnels)

  // 2. 合并预设配置和用户配置
  const finalConfig = mergeConfigs(presetConfig, userConfig, type)

  // 3. 确保目录存在
  const targetDir = configPath.includes('/') || configPath.includes('\\')
    ? configPath.substring(0, Math.max(configPath.lastIndexOf('/'), configPath.lastIndexOf('\\')))
    : '.'
  ensureDir(targetDir)

  // 4. 写入配置文件
  writeFileSync(configPath, finalConfig, 'utf-8')
}

/**
 * 将 tunnels 数组转换为 TOML 格式
 */
function tunnelsToToml(tunnels: ProxyConfig[]): string {
  if (!tunnels || tunnels.length === 0) {
    return ''
  }

  const lines: string[] = []

  for (const tunnel of tunnels) {
    lines.push('')
    lines.push('[[proxies]]')
    for (const [key, value] of Object.entries(tunnel)) {
      if (value === undefined || value === null)
        continue
      if (typeof value === 'string') {
        lines.push(`${key} = "${value}"`)
      }
      else if (typeof value === 'number' || typeof value === 'boolean') {
        lines.push(`${key} = ${value}`)
      }
      else if (typeof value === 'object') {
        lines.push(`[${key}]`)
        for (const [subKey, subValue] of Object.entries(value)) {
          if (typeof subValue === 'string') {
            lines.push(`${subKey} = "${subValue}"`)
          }
          else {
            lines.push(`${subKey} = ${subValue}`)
          }
        }
      }
    }
  }

  return lines.join('\n')
}

/**
 * 将对象转换为 TOML 格式
 */
function objectToToml(obj: Record<string, any>, sectionPrefix = ''): string {
  const lines: string[] = []

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null)
      continue

    if (typeof value === 'object' && !Array.isArray(value)) {
      // 嵌套对象，创建子 section
      const sectionKey = sectionPrefix ? `${sectionPrefix}.${key}` : key
      lines.push(`[${sectionKey}]`)
      for (const [subKey, subValue] of Object.entries(value)) {
        if (typeof subValue === 'string') {
          lines.push(`${subKey} = "${subValue}"`)
        }
        else if (typeof subValue === 'boolean' || typeof subValue === 'number') {
          lines.push(`${subKey} = ${subValue}`)
        }
      }
    }
    else if (typeof value === 'string') {
      lines.push(`${key} = "${value}"`)
    }
    else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key} = ${value}`)
    }
  }

  return lines.join('\n')
}

/**
 * 将配置对象转换为 TOML 格式
 */
export function configToToml(config: Record<string, any>): string {
  return toToml(config)
}

/**
 * 验证预设配置
 */
export function validatePresetConfig(
  config: PresetConfig,
  type: 'frps' | 'frpc'
): { valid: boolean, errors: string[] } {
  const errors: string[] = []
  const cfg = type === 'frps' ? config.frps : config.frpc

  if (!cfg) {
    return { valid: true, errors: [] }
  }

  // 基本验证
  if (type === 'frps') {
    const frpsConfig = cfg as FrpsPresetConfig
    if (frpsConfig.bindPort !== undefined && (frpsConfig.bindPort < 1 || frpsConfig.bindPort > 65535)) {
      errors.push('bindPort must be between 1 and 65535')
    }
    if (frpsConfig.vhostHTTPPort !== undefined && (frpsConfig.vhostHTTPPort < 1 || frpsConfig.vhostHTTPPort > 65535)) {
      errors.push('vhostHTTPPort must be between 1 and 65535')
    }
    if (frpsConfig.dashboardPort !== undefined && (frpsConfig.dashboardPort < 1 || frpsConfig.dashboardPort > 65535)) {
      errors.push('dashboardPort must be between 1 and 65535')
    }
  }
  else {
    const frpcConfig = cfg as FrpcPresetConfig
    if (frpcConfig.serverPort !== undefined && (frpcConfig.serverPort < 1 || frpcConfig.serverPort > 65535)) {
      errors.push('serverPort must be between 1 and 65535')
    }
    if (frpcConfig.serverAddr && typeof frpcConfig.serverAddr !== 'string') {
      errors.push('serverAddr must be a string')
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * 配置合并方法
 * 将预设配置和用户配置合并成最终的 frp 配置
 */

import type { ProxyConfig } from '@frp-bridge/types'
import type { PresetConfig } from './preset-config'
import { writeFileSync } from 'node:fs'
import { ensureDir, stringify as toToml } from '@frp-bridge/core'

/**
 * 合并预设配置和用户配置，生成最终的 TOML 配置
 * @param presetConfig 预设配置
 * @param userConfig 用户配置的 TOML 字符串
 * @param type 配置类型 'frps' | 'frpc'
 * @returns 最终的 TOML 配置字符串
 */
export function mergeConfigs(
  presetConfig: PresetConfig,
  userConfig: string,
  type: 'frps' | 'frpc'
): string {
  const typeConfig = presetConfig[type]

  if (!typeConfig) {
    // 如果没有预设配置，直接返回用户配置
    return userConfig
  }

  // 解析用户配置
  const userConfigLines = userConfig.split('\n')

  // 提取用户配置中的代理部分
  const proxiesSection = extractProxiesSection(userConfigLines)

  // 生成最终配置
  const finalConfigLines: string[] = []

  // 1. 添加预设配置的基础参数
  if (type === 'frps') {
    const frpsConfig = typeConfig as import('./preset-config').FrpsPresetConfig

    if (frpsConfig.bindPort) {
      finalConfigLines.push(`bindPort = ${frpsConfig.bindPort}`)
    }
    if (frpsConfig.vhostHTTPPort) {
      finalConfigLines.push(`vhostHTTPPort = ${frpsConfig.vhostHTTPPort}`)
    }
    if (frpsConfig.dashboardPort) {
      finalConfigLines.push('')
      finalConfigLines.push('[webServer]')
      finalConfigLines.push(`addr = "0.0.0.0"`)
      finalConfigLines.push(`port = ${frpsConfig.dashboardPort}`)
      if (frpsConfig.dashboardUser) {
        finalConfigLines.push(`user = "${frpsConfig.dashboardUser}"`)
      }
      if (frpsConfig.dashboardPassword) {
        finalConfigLines.push(`password = "${frpsConfig.dashboardPassword}"`)
      }
    }
  }
  else if (type === 'frpc') {
    const frpcConfig = typeConfig as import('./preset-config').FrpcPresetConfig

    if (frpcConfig.serverAddr) {
      finalConfigLines.push(`serverAddr = "${frpcConfig.serverAddr}"`)
    }
    if (frpcConfig.serverPort) {
      finalConfigLines.push(`serverPort = ${frpcConfig.serverPort}`)
    }
    if (frpcConfig.authToken) {
      finalConfigLines.push(`auth.token = "${frpcConfig.authToken}"`)
    }
  }

  // 2. 添加用户配置中的代理部分
  if (proxiesSection) {
    finalConfigLines.push('')
    finalConfigLines.push(...proxiesSection)
  }

  return finalConfigLines.join('\n')
}

/**
 * 从 tunnels 数组生成并保存 FRP 配置文件
 * @param configPath 配置文件路径
 * @param tunnels tunnels 数组
 * @param presetConfig 预设配置
 * @param type 配置类型 'frps' | 'frpc'
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

  return toToml({ proxies: tunnels })
}

/**
 * 从用户配置中提取代理部分
 */
function extractProxiesSection(lines: string[]): string[] {
  const proxiesSection: string[] = []
  let inProxies = false

  for (const line of lines) {
    // 检查是否是代理定义
    if (line.trim().startsWith('[[proxies]]')) {
      inProxies = true
    }

    if (inProxies) {
      proxiesSection.push(line)
    }
  }

  return proxiesSection
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
  const typeConfig = config[type]

  if (!typeConfig) {
    return { valid: true, errors: [] }
  }

  if (type === 'frps') {
    const frpsConfig = typeConfig as import('./preset-config').FrpsPresetConfig

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

    if (frpsConfig.domain !== undefined && !frpsConfig.domain) {
      errors.push('domain cannot be empty')
    }
  }
  else if (type === 'frpc') {
    const frpcConfig = typeConfig as import('./preset-config').FrpcPresetConfig

    if (frpcConfig.serverPort !== undefined) {
      if (frpcConfig.serverPort < 1 || frpcConfig.serverPort > 65535) {
        errors.push('serverPort must be between 1-65535')
      }
    }

    if (frpcConfig.serverAddr !== undefined && !frpcConfig.serverAddr) {
      errors.push('serverAddr cannot be empty')
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

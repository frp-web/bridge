/**
 * 配置合并方法
 * 将预设配置和用户配置合并成最终的 frp 配置
 */

import type { ProxyConfig } from '@frp-bridge/types'
import type { PresetConfig } from './preset-config'
import { writeFileSync } from 'node:fs'
import { ensureDir, stringify as toToml } from '@frp-bridge/core'
import { ConfigStrategyFactory } from './config/strategy'

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
  const strategy = ConfigStrategyFactory.getStrategy(type)
  return strategy.merge(presetConfig, userConfig)
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
  const strategy = ConfigStrategyFactory.getStrategy(type)
  if (strategy.validate) {
    return strategy.validate(config)
  }
  return { valid: true, errors: [] }
}

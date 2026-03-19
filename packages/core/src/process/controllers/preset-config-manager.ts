/**
 * PresetConfigManager - 预设配置管理
 * 负责加载和保存预设配置，支持与用户配置合并
 */

import type { PresetConfig } from '../../config-merger'
import type { RuntimeLogger } from '../../runtime'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { consola } from 'consola'
import { join } from 'pathe'

import { DEFAULT_PRESET_CONFIG } from '../../config-merger'
import { ensureDir } from '../../utils'

export interface PresetConfigManagerOptions {
  /** Working directory */
  workDir: string
  /** Config directory (defaults to workDir/config) */
  configDir?: string
  /** Optional logger */
  logger?: RuntimeLogger
}

/**
 * PresetConfigManager 管理预设配置的读写
 */
export class PresetConfigManager {
  private readonly logger: RuntimeLogger
  private readonly configDir: string

  constructor(options: PresetConfigManagerOptions) {
    this.logger = options.logger ?? consola.withTag('PresetConfigManager')
    this.configDir = options.configDir || join(options.workDir, 'config')
  }

  /**
   * 获取预设配置文件路径
   */
  getPresetConfigPath(type: 'frps' | 'frpc'): string {
    return join(this.configDir, `${type}-preset.json`)
  }

  /**
   * 加载预设配置
   */
  load(type: 'frps' | 'frpc'): PresetConfig {
    const presetPath = this.getPresetConfigPath(type)

    if (!existsSync(presetPath)) {
      // 返回默认配置
      this.logger.info(`Preset config not found at ${presetPath}, using defaults for ${type}`)
      return {
        [type]: DEFAULT_PRESET_CONFIG[type] || {}
      }
    }

    try {
      const content = readFileSync(presetPath, 'utf-8')
      const config = JSON.parse(content)
      return { [type]: config }
    }
    catch (error) {
      this.logger.error(`Failed to load preset config for ${type}:`, { error })
      return {
        [type]: DEFAULT_PRESET_CONFIG[type] || {}
      }
    }
  }

  /**
   * 保存预设配置
   */
  save(type: 'frps' | 'frpc', config: Record<string, any>): void {
    const presetPath = this.getPresetConfigPath(type)

    // 确保目录存在
    ensureDir(this.configDir)

    writeFileSync(presetPath, JSON.stringify(config, null, 2), 'utf-8')
    this.logger.info(`Preset config saved for ${type}`)
  }

  /**
   * 获取默认预设配置
   */
  getDefaultConfig(type: 'frps' | 'frpc'): Record<string, any> {
    return DEFAULT_PRESET_CONFIG[type] || {}
  }
}

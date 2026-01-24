/**
 * 预设配置定义
 * 预设配置是系统级配置，用户通过 frp-web 的特定表单设置，不能直接修改文件
 */

export interface PresetConfig {
  // frps 预设配置
  frps?: FrpsPresetConfig

  // frpc 预设配置
  frpc?: FrpcPresetConfig
}

export interface FrpsPresetConfig {
  bindPort?: number
  vhostHTTPPort?: number
  domain?: string
  dashboardPort?: number
  dashboardUser?: string
  dashboardPassword?: string
}

export interface FrpcPresetConfig {
  serverAddr?: string
  serverPort?: number
  authToken?: string
}

/**
 * 默认预设配置
 */
export const DEFAULT_PRESET_CONFIG: PresetConfig = {
  frps: {
    bindPort: 7000,
    vhostHTTPPort: 7000,
    dashboardPort: 7500,
    dashboardUser: 'admin'
  },
  frpc: {
    serverPort: 7000
  }
}

/**
 * 预设配置的存储键
 */
export const PRESET_CONFIG_KEY = 'frp:preset-config'

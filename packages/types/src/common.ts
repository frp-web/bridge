/**
 * FRP 通用配置类型定义
 * 基于 frp 官方文档: https://gofrp.org/zh-cn/docs/reference/common/
 */

/** 日志级别类型 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

/** 日志配置 */
export interface LogConfig {
  /** 日志输出文件路径，如果为 console，则会将日志打印在标准输出中 */
  to?: string
  /** 日志级别，可选值为 trace, debug, info, warn, error，默认级别为 info */
  level?: LogLevel
  /** 日志文件最多保留天数，默认为 3 天 */
  maxDays?: number
  /** 禁用标准输出中的日志颜色 */
  disablePrintColor?: boolean
}

/** TLS 配置 */
export interface TLSConfig {
  /** TLS 证书文件路径 */
  certFile: string
  /** TLS 密钥文件路径 */
  keyFile: string
  /** CA 证书文件路径 */
  trustedCaFile?: string
  /** TLS Server 名称 */
  serverName?: string
}

/** Web 服务器配置 */
export interface WebServerConfig {
  /** webServer 监听地址，默认为 127.0.0.1 */
  addr?: string
  /** webServer 监听端口 */
  port: number
  /** HTTP BasicAuth 用户名 */
  user?: string
  /** HTTP BasicAuth 密码 */
  password?: string
  /** 静态资源目录，Dashboard 使用的资源默认打包在二进制文件中，通过指定此参数使用自定义的静态资源 */
  assetsDir?: string
  /** 启动 Go HTTP pprof，用于应用调试 */
  pprofEnable?: boolean
  /** Dashboard 启用 HTTPS 的 TLS 相关配置 */
  tls?: TLSConfig
}

/** QUIC 协议选项 */
export interface QUICOptions {
  /** 保活周期，默认值为 10 秒 */
  keepalivePeriod?: number
  /** 最大空闲超时时间，默认值为 30 秒 */
  maxIdleTimeout?: number
  /** 最大传入流数量，默认值为 100000 */
  maxIncomingStreams?: number
}

/** 端口范围配置 */
export interface PortsRange {
  /** 起始端口 */
  start?: number
  /** 终止端口 */
  end?: number
  /** 单一端口 */
  single?: number
}

/** HTTP 头部操作配置 */
export interface HeaderOperations {
  /** 在 Header 中设置指定的 KV 值 */
  set?: Record<string, string>
}

/** HTTP 头部配置 */
export interface HTTPHeader {
  /** Header 名称 */
  name: string
  /** Header 值 */
  value: string
}

/** 文件数据源配置 */
export interface FileSource {
  /** 文件路径 */
  path: string
}

/** 数据源类型 */
export type ValueSourceType = 'file'

/** 值数据源配置 */
export interface ValueSource {
  /** 数据源类型，目前仅支持 "file" */
  type: ValueSourceType
  /** 文件数据源配置，当 type 为 "file" 时必填 */
  file?: FileSource
}

/** NAT 穿透配置 */
export interface NatTraversalConfig {
  /**
   * 禁用本地网络接口地址的辅助连接。当启用时，仅使用通过 STUN 发现的公网地址进行 NAT 打洞，
   * 避免使用可能较慢的本地网络接口（如 VPN）。默认为 false
   */
  disableAssistedAddrs?: boolean
}

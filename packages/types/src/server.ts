/**
 * FRP 服务端配置类型定义
 * 基于 frp 官方文档: https://gofrp.org/zh-cn/docs/reference/server-configures/
 */

import type {
  LogConfig,
  PortsRange,
  QUICOptions,
  TLSConfig,
  ValueSource,
  WebServerConfig
} from './common.js'

/** 鉴权方式类型 */
export type AuthMethod = 'token' | 'oidc'

/** 鉴权信息附加范围类型 */
export type AuthScope = 'HeartBeats' | 'NewWorkConns'

/** OIDC 服务端鉴权配置 */
export interface AuthOIDCServerConfig {
  /** OIDC 发行者 */
  issuer?: string
  /** OIDC 受众 */
  audience?: string
  /** 跳过过期检查 */
  skipExpiryCheck?: boolean
  /** 跳过发行者检查 */
  skipIssuerCheck?: boolean
}

/** 服务端鉴权配置 */
export interface AuthServerConfig {
  /** 鉴权方式，可选值为 token 或 oidc，默认为 token */
  method?: AuthMethod
  /** 鉴权信息附加范围，可选值为 HeartBeats 和 NewWorkConns */
  additionalScopes?: AuthScope[]
  /** 在 method 为 token 时生效，客户端需要设置一样的值才能鉴权通过。与 tokenSource 字段互斥 */
  token?: string
  /** 从文件中加载 token 的配置。与 token 字段互斥 */
  tokenSource?: ValueSource
  /** oidc 鉴权配置 */
  oidc?: AuthOIDCServerConfig
}

/** 服务端 TLS 配置 */
export interface TLSServerConfig extends TLSConfig {
  /** 是否只接受启用了 TLS 的客户端连接 */
  force?: boolean
}

/** 服务端传输层配置 */
export interface ServerTransportConfig {
  /** tcp mux 的心跳检查间隔时间，单位秒 */
  tcpMuxKeepaliveInterval?: number
  /** 和客户端底层 TCP 连接的 keepalive 间隔时间，单位秒，配置为负数表示不启用 */
  tcpKeepalive?: number
  /** 允许客户端设置的最大连接池大小，如果客户端配置的值大于此值，会被强制修改为最大值，默认为 5 */
  maxPoolCount?: number
  /** 服务端和客户端心跳连接的超时时间，单位秒，默认为 90 秒 */
  heartbeatTimeout?: number
  /** QUIC 协议配置参数 */
  quic?: QUICOptions
  /** 服务端 TLS 协议配置 */
  tls?: TLSServerConfig
}

/** HTTP 插件选项 */
export interface HTTPPluginOptions {
  /** 插件名称 */
  name: string
  /** 插件接口的地址 */
  addr: string
  /** 插件接口的 Path */
  path: string
  /** 插件需要生效的操作列表，具体可选值请参考服务端插件的说明文档 */
  ops: string[]
  /** 当插件地址为 HTTPS 协议时，是否校验插件的 TLS 证书，默认为不校验 */
  tlsVerify?: boolean
}

/** SSH 隧道网关配置 */
export interface SSHTunnelGateway {
  /** SSH 服务器监听端口 */
  bindPort: number
  /** SSH 服务器私钥文件路径。若为空，frps将读取autoGenPrivateKeyPath路径下的私钥文件 */
  privateKeyFile?: string
  /** 私钥文件自动生成路径，默认为./.autogen_ssh_key。若文件不存在或内容为空，frps将自动生成RSA私钥文件并存储到该路径 */
  autoGenPrivateKeyPath?: string
  /** SSH 客户端授权密钥文件路径。若为空，则不进行SSH客户端鉴权认证。非空可实现SSH免密登录认证 */
  authorizedKeysFile?: string
}

/** 服务端配置 */
export interface ServerConfig {
  /** 鉴权配置 */
  auth?: AuthServerConfig
  /** 服务端监听地址，用于接收 frpc 的连接，默认监听 0.0.0.0 */
  bindAddr?: string
  /** 服务端监听端口，默认值为 7000 */
  bindPort?: number
  /** 服务端监听 KCP 协议端口，用于接收配置了使用 KCP 协议的 frpc 连接 */
  kcpBindPort?: number
  /** 服务端监听 QUIC 协议端口，用于接收配置了使用 QUIC 协议的 frpc 连接 */
  quicBindPort?: number
  /** 代理监听地址，可以使代理监听在不同的网卡地址，默认情况下同 bindAddr */
  proxyBindAddr?: string
  /** HTTP 类型代理监听的端口，启用后才能支持 HTTP 类型的代理 */
  vhostHTTPPort?: number
  /** HTTP 类型代理在服务端的 ResponseHeader 超时时间，默认为 60s */
  vhostHTTPTimeout?: number
  /** HTTPS 类型代理监听的端口，启用后才能支持 HTTPS 类型的代理 */
  vhostHTTPSPort?: number
  /** tcpmux 类型且复用器为 httpconnect 的代理监听的端口 */
  tcpmuxHTTPConnectPort?: number
  /** 对于 tcpmux 类型的代理是否透传 CONNECT 请求 */
  tcpmuxPassthrough?: boolean
  /** 二级域名后缀 */
  subDomainHost?: string
  /** 自定义 404 错误页面地址 */
  custom404Page?: string
  /** ssh 隧道网关配置 */
  sshTunnelGateway?: SSHTunnelGateway
  /** 服务端 Dashboard 配置 */
  webServer?: WebServerConfig
  /** 是否提供 Prometheus 监控接口，需要同时启用了 webServer 后才会生效 */
  enablePrometheus?: boolean
  /** 日志配置 */
  log?: LogConfig
  /** 网络层配置 */
  transport?: ServerTransportConfig
  /** 服务端返回详细错误信息给客户端，默认为 true */
  detailedErrorsToClient?: boolean
  /** 限制单个客户端最大同时存在的代理数，默认无限制 */
  maxPortsPerClient?: number
  /** 用户建立连接后等待客户端响应的超时时间，单位秒，默认为 10 秒 */
  userConnTimeout?: number
  /** 代理 UDP 服务时支持的最大包长度，默认为 1500，服务端和客户端的值需要一致 */
  udpPacketSize?: number
  /** 打洞策略数据的保留时间，默认为 168 小时，即 7 天 */
  natholeAnalysisDataReserveHours?: number
  /** 允许代理绑定的服务端端口 */
  allowPorts?: PortsRange[]
  /** 服务端 HTTP 插件配置 */
  httpPlugins?: HTTPPluginOptions[]
}

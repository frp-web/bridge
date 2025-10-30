/**
 * FRP 客户端配置类型定义
 * 基于 frp 官方文档: https://gofrp.org/zh-cn/docs/reference/client-configures/
 */

import type {
  LogConfig,
  QUICOptions,
  TLSConfig,
  ValueSource,
  WebServerConfig
} from './common.js'
import type { AuthMethod, AuthScope } from './server.js'

/** 客户端传输协议类型 */
export type ClientTransportProtocol = 'tcp' | 'kcp' | 'quic' | 'websocket' | 'wss'

/** OIDC 客户端鉴权配置 */
export interface AuthOIDCClientConfig {
  /** OIDC 客户端 ID */
  clientID?: string
  /** OIDC 客户端密钥 */
  clientSecret?: string
  /** OIDC audience 参数 */
  audience?: string
  /** OIDC scope 参数 */
  scope?: string
  /** OIDC 令牌端点 URL */
  tokenEndpointURL?: string
  /** 附加的端点参数 */
  additionalEndpointParams?: Record<string, string>
  /** 信任的 CA 证书文件路径，用于验证 OIDC 服务器的 TLS 证书 */
  trustedCaFile?: string
  /** 跳过 TLS 证书验证，不推荐在生产环境使用 */
  insecureSkipVerify?: boolean
  /** 访问 OIDC 令牌端点时使用的代理服务器 URL */
  proxyURL?: string
}

/** 客户端鉴权配置 */
export interface AuthClientConfig {
  /** 鉴权方式，可选值为 token 或 oidc，默认为 token */
  method?: AuthMethod
  /** 鉴权信息附加范围，可选值为 HeartBeats 和 NewWorkConns */
  additionalScopes?: AuthScope[]
  /** 在 method 为 token 时生效，客户端需要设置一样的值才能鉴权通过。与 tokenSource 字段互斥 */
  token?: string
  /** 从文件中加载 token 的配置。与 token 字段互斥 */
  tokenSource?: ValueSource
  /** oidc 鉴权配置 */
  oidc?: AuthOIDCClientConfig
}

/** 客户端 TLS 配置 */
export interface TLSClientConfig extends TLSConfig {
  /** 是否和服务端之间启用 TLS 连接，默认启用 */
  enable?: boolean
  /** 启用 TLS 连接时，不发送 0x17 特殊字节。默认为 true。当配置为 true 时，无法和 vhostHTTPSPort 端口复用 */
  disableCustomTLSFirstByte?: boolean
}

/** 客户端传输层配置 */
export interface ClientTransportConfig {
  /** 和 frps 之间的通信协议，可选值为 tcp, kcp, quic, websocket, wss。默认为 tcp */
  protocol?: ClientTransportProtocol
  /** 连接服务端的超时时间，默认为 10s */
  dialServerTimeout?: number
  /** 和服务端底层 TCP 连接的 keepalive 间隔时间，单位秒 */
  dialServerKeepalive?: number
  /** 连接服务端时所绑定的本地 IP */
  connectServerLocalIP?: string
  /** 连接服务端使用的代理地址，格式为 {protocol}://user:passwd@192.168.1.128:8080 protocol 目前支持 http、socks5、ntlm */
  proxyURL?: string
  /** 连接池大小 */
  poolCount?: number
  /** TCP 多路复用，默认启用 */
  tcpMux?: boolean
  /** tcp_mux 的心跳检查间隔时间 */
  tcpMuxKeepaliveInterval?: number
  /** QUIC 协议配置参数 */
  quic?: QUICOptions
  /** 向服务端发送心跳包的间隔时间，默认为 30s。建议启用 tcp_mux_keepalive_interval，将此值设置为 -1 */
  heartbeatInterval?: number
  /** 和服务端心跳的超时时间，默认为 90s */
  heartbeatTimeout?: number
  /** 客户端 TLS 协议配置 */
  tls?: TLSClientConfig
}

/** 虚拟网络配置 */
export interface VirtualNetConfig {
  /** 虚拟网络接口的 IP 地址和网段，格式为 CIDR (例如 "100.86.0.1/24") */
  address: string
}

/** 客户端通用配置 */
export interface ClientCommonConfig {
  /** 客户端鉴权配置 */
  auth?: AuthClientConfig
  /** 用户名，设置此参数后，代理名称会被修改为 {user}.{proxyName}，避免代理名称和其他用户冲突 */
  user?: string
  /** 连接服务端的地址 */
  serverAddr?: string
  /** 连接服务端的端口，默认为 7000 */
  serverPort?: number
  /** xtcp 打洞所需的 stun 服务器地址，默认为 stun.easyvoip.com:3478 */
  natHoleStunServer?: string
  /** 使用 DNS 服务器地址，默认使用系统配置的 DNS 服务器，指定此参数可以强制替换为自定义的 DNS 服务器地址 */
  dnsServer?: string
  /** 第一次登陆失败后是否退出，默认为 true */
  loginFailExit?: boolean
  /** 指定启用部分代理，当配置了较多代理，但是只希望启用其中部分时可以通过此参数指定，默认为全部启用 */
  start?: string[]
  /** 日志配置 */
  log?: LogConfig
  /** 客户端 AdminServer 配置 */
  webServer?: WebServerConfig
  /** 客户端网络层配置 */
  transport?: ClientTransportConfig
  /** 虚拟网络配置，Alpha 特性 */
  virtualNet?: VirtualNetConfig
  /** 特性门控，用于启用或禁用实验性功能 */
  featureGates?: Record<string, boolean>
  /** 代理 UDP 服务时支持的最大包长度，默认为 1500，服务端和客户端需要保持配置一致 */
  udpPacketSize?: number
  /** 附加元数据，会传递给服务端插件，提供附加能力 */
  metadatas?: Record<string, string>
  /** 指定额外的配置文件目录，其中的 proxy 和 visitor 配置会被读取加载 */
  includes?: string[]
}

/** 客户端配置 */
export interface ClientConfig extends ClientCommonConfig {
  // 如果需要代理配置，可以后续添加
}

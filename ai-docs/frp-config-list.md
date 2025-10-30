# FRP 配置类型整理列表

基于 frp 官方文档（https://gofrp.org/zh-cn/docs/reference/）整理的客户端和服务端配置类型。

## 1. 通用配置 (Common)
> 文件: `src/types/common.ts`

### 1.1 LogConfig
- **to**: string - 日志输出文件路径，如果为 console，则会将日志打印在标准输出中
- **level**: string - 日志级别，可选值为 trace, debug, info, warn, error，默认级别为 info
- **maxDays**: int - 日志文件最多保留天数，默认为 3 天
- **disablePrintColor**: bool - 禁用标准输出中的日志颜色

### 1.2 WebServerConfig
- **addr**: string - webServer 监听地址，默认为 127.0.0.1
- **port**: int - webServer 监听端口 (必填)
- **user**: string - HTTP BasicAuth 用户名
- **password**: string - HTTP BasicAuth 密码
- **assetsDir**: string - 静态资源目录
- **pprofEnable**: bool - 启动 Go HTTP pprof，用于应用调试
- **tls**: TLSConfig - Dashboard 启用 HTTPS 的 TLS 相关配置

### 1.3 TLSConfig
- **certFile**: string - TLS 证书文件路径 (必填)
- **keyFile**: string - TLS 密钥文件路径 (必填)
- **trustedCaFile**: string - CA 证书文件路径
- **serverName**: string - TLS Server 名称

### 1.4 QUICOptions
- **keepalivePeriod**: int - 默认值为 10 秒
- **maxIdleTimeout**: int - 默认值为 30 秒
- **maxIncomingStreams**: int - 默认值为 100000

### 1.5 PortsRange
- **start**: int - 起始端口
- **end**: int - 终止端口
- **single**: int - 单一端口

### 1.6 HeaderOperations
- **set**: map[string]string - 在 Header 中设置指定的 KV 值

### 1.7 HTTPHeader
- **name**: string - Header 名称 (必填)
- **value**: string - Header 值 (必填)

### 1.8 ValueSource
- **type**: string - 数据源类型，目前仅支持 "file" (必填)
- **file**: FileSource - 文件数据源配置

### 1.9 FileSource
- **path**: string - 文件路径 (必填)

### 1.10 NatTraversalConfig
- **disableAssistedAddrs**: bool - 禁用本地网络接口地址的辅助连接

## 2. 服务端配置 (Server)
> 文件: `src/types/server.ts`

### 2.1 ServerConfig
- **auth**: AuthServerConfig - 鉴权配置
- **bindAddr**: string - 服务端监听地址
- **bindPort**: int - 服务端监听端口，默认值为 7000
- **kcpBindPort**: int - 服务端监听 KCP 协议端口
- **quicBindPort**: int - 服务端监听 QUIC 协议端口
- **proxyBindAddr**: string - 代理监听地址
- **vhostHTTPPort**: int - HTTP 类型代理监听的端口
- **vhostHTTPTimeout**: int - HTTP 类型代理在服务端的 ResponseHeader 超时时间
- **vhostHTTPSPort**: int - HTTPS 类型代理监听的端口
- **tcpmuxHTTPConnectPort**: int - tcpmux 类型且复用器为 httpconnect 的代理监听的端口
- **tcpmuxPassthrough**: bool - 对于 tcpmux 类型的代理是否透传 CONNECT 请求
- **subDomainHost**: string - 二级域名后缀
- **custom404Page**: string - 自定义 404 错误页面地址
- **sshTunnelGateway**: SSHTunnelGateway - ssh 隧道网关配置
- **webServer**: WebServerConfig - 服务端 Dashboard 配置
- **enablePrometheus**: bool - 是否提供 Prometheus 监控接口
- **log**: LogConfig - 日志配置
- **transport**: ServerTransportConfig - 网络层配置
- **detailedErrorsToClient**: bool - 服务端返回详细错误信息给客户端
- **maxPortsPerClient**: int - 限制单个客户端最大同时存在的代理数
- **userConnTimeout**: int - 用户建立连接后等待客户端响应的超时时间
- **udpPacketSize**: int - 代理 UDP 服务时支持的最大包长度
- **natholeAnalysisDataReserveHours**: int - 打洞策略数据的保留时间
- **allowPorts**: []PortsRange - 允许代理绑定的服务端端口
- **httpPlugins**: []HTTPPluginOptions - 服务端 HTTP 插件配置

### 2.2 AuthServerConfig
- **method**: string - 鉴权方式，可选值为 token 或 oidc
- **additionalScopes**: []string - 鉴权信息附加范围
- **token**: string - token 鉴权值
- **tokenSource**: ValueSource - 从文件中加载 token 的配置
- **oidc**: AuthOIDCServerConfig - oidc 鉴权配置

### 2.3 AuthOIDCServerConfig
- **issuer**: string
- **audience**: string
- **skipExpiryCheck**: bool
- **skipIssuerCheck**: bool

### 2.4 ServerTransportConfig
- **tcpMuxKeepaliveInterval**: int - tcp mux 的心跳检查间隔时间
- **tcpKeepalive**: int - 和客户端底层 TCP 连接的 keepalive 间隔时间
- **maxPoolCount**: int - 允许客户端设置的最大连接池大小
- **heartbeatTimeout**: int - 服务端和客户端心跳连接的超时时间
- **quic**: QUICOptions - QUIC 协议配置参数
- **tls**: TLSServerConfig - 服务端 TLS 协议配置

### 2.5 TLSServerConfig
- **force**: bool - 是否只接受启用了 TLS 的客户端连接
- **TLSConfig** - TLS 协议配置，内嵌结构

### 2.6 HTTPPluginOptions
- **name**: string - 插件名称 (必填)
- **addr**: string - 插件接口的地址 (必填)
- **path**: string - 插件接口的 Path (必填)
- **ops**: []string - 插件需要生效的操作列表 (必填)
- **tlsVerify**: bool - 当插件地址为 HTTPS 协议时，是否校验插件的 TLS 证书

### 2.7 SSHTunnelGateway
- **bindPort**: int - SSH 服务器监听端口 (必填)
- **privateKeyFile**: string - SSH 服务器私钥文件路径
- **autoGenPrivateKeyPath**: string - 私钥文件自动生成路径
- **authorizedKeysFile**: string - SSH 客户端授权密钥文件路径

## 3. 客户端配置 (Client)
> 文件: `src/types/client.ts`

### 3.1 ClientConfig
- **ClientCommonConfig** - 客户端通用配置 (内嵌结构)

### 3.2 ClientCommonConfig
- **auth**: AuthClientConfig - 客户端鉴权配置
- **user**: string - 用户名
- **serverAddr**: string - 连接服务端的地址
- **serverPort**: int - 连接服务端的端口，默认为 7000
- **natHoleStunServer**: string - xtcp 打洞所需的 stun 服务器地址
- **dnsServer**: string - 使用 DNS 服务器地址
- **loginFailExit**: bool - 第一次登陆失败后是否退出
- **start**: []string - 指定启用部分代理
- **log**: LogConfig - 日志配置
- **webServer**: WebServerConfig - 客户端 AdminServer 配置
- **transport**: ClientTransportConfig - 客户端网络层配置
- **virtualNet**: VirtualNetConfig - 虚拟网络配置
- **featureGates**: map[string]bool - 特性门控
- **udpPacketSize**: int - 代理 UDP 服务时支持的最大包长度
- **metadatas**: map[string]string - 附加元数据
- **includes**: []string - 指定额外的配置文件目录

### 3.3 ClientTransportConfig
- **protocol**: string - 和 frps 之间的通信协议
- **dialServerTimeout**: int - 连接服务端的超时时间
- **dialServerKeepalive**: int - 和服务端底层 TCP 连接的 keepalive 间隔时间
- **connectServerLocalIP**: string - 连接服务端时所绑定的本地 IP
- **proxyURL**: string - 连接服务端使用的代理地址
- **poolCount**: int - 连接池大小
- **tcpMux**: bool - TCP 多路复用
- **tcpMuxKeepaliveInterval**: int - tcp_mux 的心跳检查间隔时间
- **quic**: QUICOptions - QUIC 协议配置参数
- **heartbeatInterval**: int - 向服务端发送心跳包的间隔时间
- **heartbeatTimeout**: int - 和服务端心跳的超时时间
- **tls**: TLSClientConfig - 客户端 TLS 协议配置

### 3.4 TLSClientConfig
- **enable**: bool - 是否和服务端之间启用 TLS 连接
- **disableCustomTLSFirstByte**: bool - 启用 TLS 连接时，不发送 0x17 特殊字节
- **TLSConfig** - TLS 协议配置，内嵌结构

### 3.5 AuthClientConfig
- **method**: string - 鉴权方式，可选值为 token 或 oidc
- **additionalScopes**: []string - 鉴权信息附加范围
- **token**: string - token 鉴权值
- **tokenSource**: ValueSource - 从文件中加载 token 的配置
- **oidc**: AuthOIDCClientConfig - oidc 鉴权配置

### 3.6 AuthOIDCClientConfig
- **clientID**: string - OIDC 客户端 ID
- **clientSecret**: string - OIDC 客户端密钥
- **audience**: string - OIDC audience 参数
- **scope**: string - OIDC scope 参数
- **tokenEndpointURL**: string - OIDC 令牌端点 URL
- **additionalEndpointParams**: map[string]string - 附加的端点参数
- **trustedCaFile**: string - 信任的 CA 证书文件路径
- **insecureSkipVerify**: bool - 跳过 TLS 证书验证
- **proxyURL**: string - 访问 OIDC 令牌端点时使用的代理服务器 URL

### 3.7 VirtualNetConfig
- **address**: string - 虚拟网络接口的 IP 地址和网段 (必填)

## 总结

配置类型包括：
- **通用配置**: 10个类型定义 ✅ 已完成
- **服务端配置**: 7个类型定义 ✅ 已完成
- **客户端配置**: 7个类型定义 ✅ 已完成

## 已创建的 TypeScript 文件

- `src/types/common.ts` - 通用配置类型 ✅
- `src/types/server.ts` - 服务端配置类型 ✅
- `src/types/client.ts` - 客户端配置类型 ✅
- `src/types/index.ts` - 主入口文件 ✅

## 使用方式

```typescript
import type {
  ClientConfig,
  LogConfig,
  ServerConfig,
  TLSConfig
  // ... 其他类型
} from './src/types/index.js'

// 示例：服务端配置
const serverConfig: ServerConfig = {
  bindPort: 7000,
  log: {
    level: 'info',
    to: './frps.log'
  },
  auth: {
    method: 'token',
    token: 'your-secret-token'
  }
}

// 示例：客户端配置
const clientConfig: ClientConfig = {
  serverAddr: 'your-server.com',
  serverPort: 7000,
  auth: {
    method: 'token',
    token: 'your-secret-token'
  }
}
```

/**
 * FRP Bridge type definitions
 * Based on: https://gofrp.org/zh-cn/docs/reference/
 */

// Client configuration types
export type {
  AuthClientConfig,
  AuthOIDCClientConfig,
  ClientCommonConfig,
  ClientConfig,
  ClientTransportConfig,
  ClientTransportProtocol,
  TLSClientConfig,
  VirtualNetConfig
} from './client'

// Common configuration types
export type {
  FileSource,
  HeaderOperations,
  HTTPHeader,
  LogConfig,
  LogLevel,
  NatTraversalConfig,
  PortsRange,
  QUICOptions,
  TLSConfig,
  ValueSource,
  ValueSourceType,
  WebServerConfig
} from './common'

// Node management types
export type {
  NodeErrorCode,
  NodeHeartbeatPayload,
  NodeInfo,
  NodeListQuery,
  NodeListResponse,
  NodeRegisterPayload,
  NodeStatistics,
  TunnelManagePayload,
  TunnelManageResponse,
  TunnelSyncPayload
} from './node'

// Proxy configuration types
export type {
  BaseProxyConfig,
  BaseVisitorConfig,
  HTTPProxyConfig,
  HTTPSProxyConfig,
  LoadBalancerStrategy,
  ProxyConfig,
  ProxyType,
  STCPProxyConfig,
  STCPVisitorConfig,
  SUDPProxyConfig,
  SUDPVisitorConfig,
  TCPMUXProxyConfig,
  TCPProxyConfig,
  UDPProxyConfig,
  VisitorConfig,
  VisitorType,
  XTCPProxyConfig,
  XTCPVisitorConfig
} from './proxy'

// RPC types
export type {
  PingMessage,
  PongMessage,
  RegisterMessage,
  RpcInboundMessage,
  RpcOutboundMessage,
  RpcRequest,
  RpcResponse
} from './rpc'

// Server configuration types
export type {
  AuthMethod,
  AuthOIDCServerConfig,
  AuthScope,
  AuthServerConfig,
  HTTPPluginOptions,
  ServerConfig,
  ServerTransportConfig,
  SSHTunnelGateway,
  TLSServerConfig
} from './server'

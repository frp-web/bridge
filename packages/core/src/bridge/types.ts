import type { ClientConfig, ProxyConfig, ServerConfig } from '@frp-bridge/types'

export interface ConfigApplyPayload {
  config: Partial<ClientConfig | ServerConfig>
  restart?: boolean
  configPath?: string
}

export interface ConfigApplyRawPayload {
  content: string
  restart?: boolean
  configPath?: string
}

export interface ProxyAddPayload {
  proxy: ProxyConfig
  nodeId?: string // Target node ID (for server mode RPC forwarding)
}

export interface ProxyUpdatePayload {
  name: string
  proxy: Partial<ProxyConfig>
  nodeId?: string // Target node ID (for server mode RPC forwarding)
}

export interface ProxyRemovePayload {
  name: string
  nodeId?: string // Target node ID (for server mode RPC forwarding)
}

export interface ProxyGetPayload {
  name: string
}

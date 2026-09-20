import type { ProxyConfig } from './proxy'

export type NodeStatus = 'online' | 'offline' | 'connecting' | 'error'

export interface NodeInfo {
  id: string
  name?: string
  ip: string
  port: number
  protocol: 'tcp' | 'udp'
  serverAddr: string
  serverPort: number
  hostname?: string
  osType?: string
  osRelease?: string
  platform?: string
  cpuCores?: number
  memTotal?: number
  frpVersion?: string
  bridgeVersion?: string
  status: NodeStatus
  lastHeartbeat?: number
  connectedAt?: number
  tunnels?: ProxyConfig[]
  labels?: Record<string, string>
  metadata?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface NodeRegisterPayload {
  ip?: string
  port?: number
  protocol?: 'tcp' | 'udp'
  serverAddr?: string
  serverPort?: number
  hostname?: string
  osType?: string
  osRelease?: string
  platform?: string
  cpuCores?: number
  memTotal?: number
  frpVersion?: string
  bridgeVersion?: string
}

export interface NodeHeartbeatPayload {
  nodeId: string
  status: NodeStatus
  cpuCores?: number
  memTotal?: number
}

export interface NodeSnapshotPayload {
  nodeId: string
  tunnels: ProxyConfig[]
  timestamp: number
}

export interface NodeListQuery {
  page?: number
  pageSize?: number
  status?: NodeStatus
  search?: string
}

export interface NodeListResponse {
  items: NodeInfo[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface NodeStatistics {
  total: number
  online: number
  offline: number
  connecting: number
  error: number
}

export type { TunnelWithNode } from './control'

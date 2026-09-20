/**
 * Control layer types: FrpControlApi, ControlEvent, tunnel/process/config shapes
 */

import type { ProxyConfig } from './proxy'

export type NodeRole = 'self' | 'peer'

export type ControlTarget = 'frps' | 'frpc'

export interface ProcessStatus {
  running: boolean
  pid?: number
  uptime?: number
  version?: string
  lastError?: string
}

export interface FrpConfigSnapshot {
  raw: string
  version: number
  hash: string
}

export type TunnelWithNode = ProxyConfig & {
  nodeId: string
  version: number
  status: 'pending' | 'running' | 'error'
}

export type ControlEventType
  = | 'tunnel:added'
    | 'tunnel:updated'
    | 'tunnel:removed'
    | 'config:applied'
    | 'process:status'

export interface ControlEvent<T = unknown> {
  type: ControlEventType
  target: ControlTarget
  nodeId: string
  payload: T
  version: number
  timestamp: number
  originatorId: string
}

export type ControlEventListener = (evt: ControlEvent) => void

export interface FrpProcessApi {
  start: () => Promise<void>
  stop: () => Promise<void>
  restart: () => Promise<void>
  status: () => Promise<ProcessStatus>
}

export interface FrpConfigApi {
  get: () => Promise<FrpConfigSnapshot>
  apply: (content: string, opts?: { restart?: boolean }) => Promise<FrpConfigSnapshot>
}

export interface FrpTunnelApi {
  list: () => Promise<TunnelWithNode[]>
  get: (name: string) => Promise<TunnelWithNode | null>
  add: (tunnel: ProxyConfig) => Promise<TunnelWithNode>
  update: (name: string, patch: Partial<ProxyConfig>) => Promise<TunnelWithNode>
  remove: (name: string) => Promise<void>
  sync: () => Promise<void>
}

export interface FrpControlApi {
  readonly nodeId: string
  readonly role: NodeRole
  readonly target: ControlTarget
  readonly capabilities: NodeCapabilities

  process: FrpProcessApi
  config: FrpConfigApi
  tunnel: FrpTunnelApi

  on: (event: ControlEventType, listener: ControlEventListener) => this
  off: (event: ControlEventType, listener: ControlEventListener) => this
  emit: (evt: ControlEvent) => void
  /** 清理资源（移除所有监听器） */
  dispose: () => void
}

export interface NodeCapabilities {
  manageTunnels: boolean
  manageConfig: boolean
  manageProcess: boolean
}

export const DEFAULT_CAPABILITIES: NodeCapabilities = {
  manageTunnels: true,
  manageConfig: false,
  manageProcess: true
}

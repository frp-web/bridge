import type { NodeInfo } from './node'

export interface RpcRequest {
  id: string
  method: string
  params: Record<string, unknown>
  timeout?: number
}

export interface RpcResponse {
  id: string
  status: 'success' | 'error'
  result?: unknown
  error?: {
    code: string
    message: string
  }
}

export interface PingMessage {
  type: 'ping'
  timestamp: number
}

export interface PongMessage {
  type: 'pong'
  timestamp: number
}

export interface RegisterMessage {
  type: 'register'
  nodeId: string
  payload: NodeInfo
}

export type RpcInboundMessage = RpcResponse | PongMessage
export type RpcOutboundMessage = RpcRequest | PingMessage | RegisterMessage

// ============================================================================
// Event-based Message Types (for compatibility with document spec)
// ============================================================================

/**
 * Base RPC message type with 'command' or 'event' type
 * This format matches the RPC architecture document specification
 */
export interface RpcMessage {
  type: 'command' | 'event'
  action: string
  payload: unknown
  id?: string
  targetNodeId?: string
}

/**
 * Command message (frps -> frpc)
 */
export interface CommandMessage extends RpcMessage {
  type: 'command'
  id: string // Command must have an ID for tracking
}

/**
 * Event message (frpc -> frps)
 */
export interface EventMessage extends RpcMessage {
  type: 'event'
  id?: string // Event may reference the original command ID
}

/**
 * Tunnel add payload
 */
export interface TunnelAddPayload {
  name: string
  type: 'tcp' | 'http' | 'https' | 'stcp' | 'sudp' | 'xtcp'
  localPort: number
  remotePort?: number
  customDomains?: string[]
  subdomain?: string
  [key: string]: unknown
}

/**
 * Tunnel delete payload
 */
export interface TunnelDeletePayload {
  name: string
}

/**
 * Tunnel response payload
 */
export interface TunnelResponsePayload {
  success: boolean
  error?: string
  tunnel?: TunnelAddPayload
}

/**
 * Node delete payload
 */
export interface NodeDeletePayload {
  name: string
}

/**
 * Node response payload
 */
export interface NodeResponsePayload {
  success: boolean
  error?: string
  deletedNode?: string
}

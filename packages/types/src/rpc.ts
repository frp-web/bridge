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

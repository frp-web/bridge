/**
 * RPC 消息类型定义
 * 提供类型安全的消息结构和类型守卫
 */

/**
 * RPC 消息类型枚举
 */
export enum RpcMessageType {
  REGISTER = 'register',
  COMMAND = 'command',
  RESPONSE = 'response',
  PING = 'ping',
  PONG = 'pong'
}

/**
 * 节点注册消息
 */
export interface RegisterMessage {
  type: RpcMessageType.REGISTER
  nodeId: string
  payload: Record<string, unknown>
}

/**
 * RPC 请求
 */
export interface RpcRequest {
  id: string
  method: string
  params: Record<string, unknown>
  timeout?: number
}

/**
 * RPC 响应状态
 */
export type RpcResponseStatus = 'success' | 'error'

/**
 * RPC 响应
 */
export interface RpcResponse {
  id: string
  status: RpcResponseStatus
  result?: unknown
  error?: { code: string, message: string }
}

/**
 * Ping 消息
 */
export interface PingMessage {
  type: RpcMessageType.PING
  timestamp: number
}

/**
 * Pong 消息
 */
export interface PongMessage {
  type: RpcMessageType.PONG
  timestamp: number
}

/**
 * 所有 RPC 消息类型
 */
export type RpcMessage = RegisterMessage | RpcRequest | RpcResponse | PingMessage | PongMessage

/**
 * 类型守卫：检查是否为注册消息
 */
export function isRegisterMessage(msg: unknown): msg is RegisterMessage {
  return typeof msg === 'object' && msg !== null && (msg as any).type === RpcMessageType.REGISTER
}

/**
 * 类型守卫：检查是否为 RPC 请求
 */
export function isRpcRequest(msg: unknown): msg is RpcRequest {
  return typeof msg === 'object' && msg !== null
    && typeof (msg as any).id === 'string'
    && typeof (msg as any).method === 'string'
}

/**
 * 类型守卫：检查是否为 RPC 响应
 */
export function isRpcResponse(msg: unknown): msg is RpcResponse {
  return typeof msg === 'object' && msg !== null
    && typeof (msg as any).id === 'string'
    && typeof (msg as any).status === 'string'
}

/**
 * 类型守卫：检查是否为 Ping 消息
 */
export function isPingMessage(msg: unknown): msg is PingMessage {
  return typeof msg === 'object' && msg !== null
    && (msg as any).type === RpcMessageType.PING
}

/**
 * 类型守卫：检查是否为 Pong 消息
 */
export function isPongMessage(msg: unknown): msg is PongMessage {
  return typeof msg === 'object' && msg !== null
    && (msg as any).type === RpcMessageType.PONG
}

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

// ============================================================================
// Event-based Message Types (compatible with architecture document)
// ============================================================================

/**
 * Event-based RPC message type (matching document spec)
 */
export interface EventRpcMessage {
  type: 'command' | 'event'
  action: string
  payload: unknown
  id?: string
  targetNodeId?: string
  [key: string]: unknown
}

/**
 * Command message (frps -> frpc)
 */
export interface CommandRpcMessage extends EventRpcMessage {
  type: 'command'
  id: string
}

/**
 * Event message (frpc -> frps)
 */
export interface EventRpcMessageEvent extends EventRpcMessage {
  type: 'event'
  id?: string
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
  nodeId?: string
  [key: string]: unknown
}

/**
 * Tunnel delete payload
 */
export interface TunnelDeletePayload {
  name: string
  nodeId?: string
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

/**
 * All message types including event-based
 */
export type AllRpcMessage = RpcMessage | EventRpcMessage

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

// ============================================================================
// Event-based Message Type Guards
// ============================================================================

/**
 * 类型守卫：检查是否为 Event-based RPC 消息
 */
export function isEventRpcMessage(msg: unknown): msg is EventRpcMessage {
  return typeof msg === 'object' && msg !== null
    && ((msg as any).type === 'command' || (msg as any).type === 'event')
    && typeof (msg as any).action === 'string'
    && 'payload' in (msg as any)
}

/**
 * 类型守卫：检查是否为 Command 消息
 */
export function isCommandMessage(msg: unknown): msg is CommandRpcMessage {
  return isEventRpcMessage(msg)
    && (msg as any).type === 'command'
    && typeof (msg as any).id === 'string'
}

/**
 * 类型守卫：检查是否为 Event 消息
 */
export function isEventMessage(msg: unknown): msg is EventRpcMessageEvent {
  return isEventRpcMessage(msg)
    && (msg as any).type === 'event'
}

/**
 * 类型守卫：检查是否为 TunnelAddPayload
 */
export function isTunnelAddPayload(data: unknown): data is TunnelAddPayload {
  if (typeof data !== 'object' || data === null)
    return false

  const payload = data as TunnelAddPayload
  return typeof payload.name === 'string'
    && typeof payload.type === 'string'
    && typeof payload.localPort === 'number'
    && (payload.remotePort === undefined || typeof payload.remotePort === 'number')
}

/**
 * 类型守卫：检查是否为 TunnelDeletePayload
 */
export function isTunnelDeletePayload(data: unknown): data is TunnelDeletePayload {
  return typeof data === 'object' && data !== null
    && typeof (data as any).name === 'string'
}

/**
 * 类型守卫：检查是否为 NodeDeletePayload
 */
export function isNodeDeletePayload(data: unknown): data is NodeDeletePayload {
  return typeof data === 'object' && data !== null
    && typeof (data as any).name === 'string'
}

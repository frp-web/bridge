/**
 * ControlMessage — 6 类 mesh 消息协议（v4.5）
 *
 * 与 JSON-RPC 2.0 无关。消息走 WebSocket 帧，天然带边界，不需要帧头。
 */

import type { ControlEvent } from './control'
import type { ProxyConfig } from './proxy'

export type ControlMessageType = 'register' | 'command' | 'ack' | 'event' | 'snapshot' | 'ping' | 'pong'

export interface RegisterPayload {
  /** mesh 节点 id */
  nodeId: string
  /** 共享密钥 */
  token: string
  /** 客户端能力 */
  capabilities?: string[]
  clientVersion?: string
}

export interface RegisterMessage {
  type: 'register'
  id: string
  payload: RegisterPayload
}

/**
 * command：RPC 调用
 * - target === 接收方 selfNodeId → 终结，调本地 api
 * - target !== 接收方 selfNodeId → S 中继：转发给 target 对应 peer
 */
export interface CommandMessage {
  type: 'command'
  id: string
  target: string
  /** 形如 `frpc.tunnel.add` */
  action: string
  /** 位置参数数组 */
  payload: unknown[]
  /** 发起方 nodeId（格式 `nodeId:<id>`），路由与回环检测用 */
  originatorId: string
  timeoutMs?: number
}

export interface AckMessage {
  type: 'ack'
  id: string
  status: 'success' | 'failed'
  result?: unknown
  error?: { code: string, message: string }
}

export interface EventMessage {
  type: 'event'
  event: ControlEvent
}

export interface SnapshotMessage {
  type: 'snapshot'
  id: string
  /** 触发的 action（对账语义） */
  action: string
  payload: unknown
}

export interface PingMessage {
  type: 'ping'
  id: string
  ts: number
}

export interface PongMessage {
  type: 'pong'
  id: string
  ts: number
  serverTs: number
}

export type ControlMessage
  = | RegisterMessage
    | CommandMessage
    | AckMessage
    | EventMessage
    | SnapshotMessage
    | PingMessage
    | PongMessage

// ---------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------

export function isRegister(msg: unknown): msg is RegisterMessage {
  return typeof msg === 'object' && msg !== null && (msg as { type?: string }).type === 'register'
}
export function isCommand(msg: unknown): msg is CommandMessage {
  return typeof msg === 'object' && msg !== null && (msg as { type?: string }).type === 'command'
}
export function isAck(msg: unknown): msg is AckMessage {
  return typeof msg === 'object' && msg !== null && (msg as { type?: string }).type === 'ack'
}
export function isEvent(msg: unknown): msg is EventMessage {
  return typeof msg === 'object' && msg !== null && (msg as { type?: string }).type === 'event'
}
export function isSnapshot(msg: unknown): msg is SnapshotMessage {
  return typeof msg === 'object' && msg !== null && (msg as { type?: string }).type === 'snapshot'
}
export function isPing(msg: unknown): msg is PingMessage {
  return typeof msg === 'object' && msg !== null && (msg as { type?: string }).type === 'ping'
}
export function isPong(msg: unknown): msg is PongMessage {
  return typeof msg === 'object' && msg !== null && (msg as { type?: string }).type === 'pong'
}

// ---------------------------------------------------------------
// Connection identity (server-side per-connection state)
// ---------------------------------------------------------------

export interface ConnectionIdentity {
  nodeId: string
  /** 内部分配的连接 id（同一 nodeId 多次重连会产生不同 clientId） */
  clientId: string
  connectedAt: number
}

// ---------------------------------------------------------------
// Snapshot payload（mesh 对账用）
// ---------------------------------------------------------------

export interface TunnelSnapshotPayload {
  nodeId: string
  tunnels: ProxyConfig[]
}

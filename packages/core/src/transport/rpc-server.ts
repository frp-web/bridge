/**
 * RpcServer — mesh 终结点 / 中继。
 *
 * 坐落在 Nuxt `/ws/rpc` defineWebSocketHandler 里：
 * 每接受一个 peer 连接 → 包装成 NuxtServerPeerTransport → 调用 accept()。
 *
 * 职责：
 *   - 校验 register 消息里的 token
 *   - 用 ControlRouter 终结 target === self 的 command
 *   - 把 target !== self 的 command 转发给目标 peer（S 中继）
 *   - 广播 event 到所有 peer（除 originator）
 *   - ping/pong 心跳
 */

import type {
  AckMessage,
  CommandMessage,
  ConnectionIdentity,
  ControlEvent,
  ControlMessage,
  EventMessage,
  FrpControlApi,
  RegisterPayload
} from '@frp-bridge/types'
import type { RpcTransport } from './rpc-transport'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { rpcServerLogger } from '@frp-bridge/shared'
import { ControlRouter } from './control-router'
import { decodeControlMessage, encodeControlMessage } from './message'

export interface RpcServerOptions {
  selfNodeId: string
  selfApi: FrpControlApi
  /** 校验 register 消息的 token；返回 false 拒绝连接 */
  validateToken: (token: string | undefined, nodeId: string | undefined) => boolean | Promise<boolean>
}

interface PeerSession {
  identity: ConnectionIdentity
  transport: RpcTransport
}

export class RpcServer extends EventEmitter {
  private readonly peers = new Map<string, PeerSession>() // key = nodeId
  private readonly pendingRegister = new Map<string, RpcTransport>() // key = clientId，等待 register
  private readonly router: ControlRouter
  private closed = false

  constructor(private readonly opts: RpcServerOptions) {
    super()
    this.router = new ControlRouter({
      selfNodeId: opts.selfNodeId,
      selfApi: opts.selfApi,
      getPeerTransport: nodeId => this.peers.get(nodeId)?.transport
    })
  }

  /**
   * 接受一个新连接。调用方必须已经在 transport 上设置好 message/close 监听。
   * transport 必须先 open，然后等待 register 消息。
   */
  async accept(transport: RpcTransport): Promise<void> {
    if (this.closed) {
      await transport.close()
      return
    }

    const clientId = randomUUID()
    this.pendingRegister.set(clientId, transport)

    transport.on('message', (raw: string) => {
      void this.handleRawMessage(clientId, transport, raw)
    })
    transport.on('close', () => {
      this.handleClose(clientId)
    })
    transport.on('error', (err: Error) => {
      this.emit('peerError', { clientId, error: err })
    })

    // 若 transport 已 open（服务端 peer 已 upgrade），直接触发
    if (transport.isOpen()) {
      // 等待 register
      return
    }
    await transport.connect()
  }

  /** 当前在线节点列表 */
  getPeerIds(): string[] {
    return [...this.peers.keys()]
  }

  /** 推送一条消息到指定节点 */
  pushTo(nodeId: string, msg: ControlMessage): boolean {
    const session = this.peers.get(nodeId)
    if (!session)
      return false
    void session.transport.send(encodeControlMessage(msg)).catch(() => { /* swallow */ })
    return true
  }

  /** 广播一条消息到所有在线 peer（可排除某个） */
  broadcast(msg: ControlMessage, exceptNodeId?: string): void {
    const data = encodeControlMessage(msg)
    for (const [nodeId, session] of this.peers) {
      if (exceptNodeId && nodeId === exceptNodeId)
        continue
      void session.transport.send(data).catch(() => { /* swallow */ })
    }
  }

  /** 本节点产生的事件 → 广播到所有 peer */
  broadcastEvent(evt: ControlEvent): void {
    const msg: EventMessage = { type: 'event', event: evt }
    this.broadcast(msg, evt.originatorId === this.opts.selfNodeId ? undefined : evt.nodeId)
  }

  async stop(): Promise<void> {
    this.closed = true
    const sessions = [...this.peers.values()]
    this.peers.clear()
    const pending = [...this.pendingRegister.values()]
    this.pendingRegister.clear()
    for (const s of sessions) {
      try {
        await s.transport.close()
      }
      catch { /* swallow */ }
    }
    for (const t of pending) {
      try {
        await t.close()
      }
      catch { /* swallow */ }
    }
  }

  // ---------------------------------------------------------
  // 内部
  // ---------------------------------------------------------

  private async handleRawMessage(clientId: string, transport: RpcTransport, raw: string): Promise<void> {
    let msg: ControlMessage
    try {
      msg = decodeControlMessage(raw)
    }
    catch (err) {
      rpcServerLogger.warn('invalid control message', { clientId, err: (err as Error).message })
      return
    }

    // 未注册前只接受 register
    if (!this.isRegistered(clientId)) {
      if (msg.type !== 'register') {
        rpcServerLogger.warn('expect register, got other type', { clientId, type: msg.type })
        return
      }
      await this.handleRegister(clientId, transport, msg.payload)
      return
    }

    const session = this.findSessionByClientId(clientId)
    if (!session)
      return
    const identity = session.identity

    switch (msg.type) {
      case 'command':
        await this.handleCommand(session, msg)
        break
      case 'ack':
        // S 中继回来的 ack — 暂时不在这里路由（Relay 模式下 ack 直接回 originator）
        break
      case 'event':
        // 对端 emit 的事件 → 本地 selfApi 也 emit 一次 + 广播到其他 peer
        this.opts.selfApi.emit(msg.event)
        this.broadcast(msg, identity.nodeId)
        this.emit('event', msg.event)
        break
      case 'snapshot':
        this.emit('snapshot', { nodeId: identity.nodeId, msg })
        break
      case 'ping': {
        const pong = { type: 'pong', id: msg.id, ts: msg.ts, serverTs: Date.now() } as const
        void session.transport.send(encodeControlMessage(pong)).catch(() => { /* swallow */ })
        break
      }
      case 'pong':
        // client 侧处理
        break
      case 'register':
        rpcServerLogger.warn('duplicate register ignored', { clientId })
        break
    }
  }

  private async handleRegister(clientId: string, transport: RpcTransport, payload: RegisterPayload): Promise<void> {
    const ok = await this.opts.validateToken(payload.token, payload.nodeId)
    if (!ok) {
      rpcServerLogger.warn('register rejected: invalid token', { nodeId: payload.nodeId })
      try {
        await transport.close()
      }
      catch { /* swallow */ }
      this.pendingRegister.delete(clientId)
      return
    }

    const identity: ConnectionIdentity = {
      nodeId: payload.nodeId,
      clientId,
      connectedAt: Date.now()
    }

    this.pendingRegister.delete(clientId)
    this.peers.set(identity.nodeId, { identity, transport })
    this.emit('connect', identity)
    rpcServerLogger.info('peer registered', { nodeId: identity.nodeId })
  }

  private async handleCommand(session: PeerSession, msg: CommandMessage): Promise<void> {
    const result = await this.router.handle(msg, session.identity)

    if (result.kind === 'forwarded') {
      // 中继：原样转发给 target，ack 由 target 直接回 originator
      const forwarded = this.pushTo(msg.target, msg)
      if (!forwarded) {
        const ack: AckMessage = {
          type: 'ack',
          id: msg.id,
          status: 'failed',
          error: { code: 'UNKNOWN_NODE', message: msg.target }
        }
        void session.transport.send(encodeControlMessage(ack)).catch(() => { /* swallow */ })
      }
      return
    }

    const ack: AckMessage = result.ok
      ? { type: 'ack', id: msg.id, status: 'success', result: result.value }
      : { type: 'ack', id: msg.id, status: 'failed', error: result.error }
    void session.transport.send(encodeControlMessage(ack)).catch(() => { /* swallow */ })
  }

  private handleClose(clientId: string): void {
    this.pendingRegister.delete(clientId)
    for (const [nodeId, session] of this.peers) {
      if (session.identity.clientId === clientId) {
        this.peers.delete(nodeId)
        this.emit('disconnect', session.identity)
        rpcServerLogger.info('peer disconnected', { nodeId })
        return
      }
    }
  }

  private isRegistered(clientId: string): boolean {
    for (const session of this.peers.values()) {
      if (session.identity.clientId === clientId)
        return true
    }
    return false
  }

  private findSessionByClientId(clientId: string): PeerSession | undefined {
    for (const session of this.peers.values()) {
      if (session.identity.clientId === clientId)
        return session
    }
    return undefined
  }
}

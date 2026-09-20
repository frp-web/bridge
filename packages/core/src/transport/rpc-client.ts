/**
 * RpcClient — mesh 出站端。
 *
 * 职责：
 *   - 出站连 S（buildWsUrl 已在外部完成）
 *   - connect → 立即 send register
 *   - sendCommand(target, action, payload) → 等 ack
 *   - 收到 event → 转给本节点 selfApi.emit
 *   - 收到 snapshot 请求 → 回 snapshot 响应
 *   - 断线 → ReconnectStrategy 退避重连 + Outbox flush
 */

import type {
  AckMessage,
  CommandMessage,
  ControlEvent,
  ControlMessage,
  EventMessage,
  FrpControlApi,
  PingMessage,
  RegisterMessage,
  SnapshotMessage,
  TunnelSnapshotPayload
} from '@frp-bridge/types'
import type { ReconnectStrategy } from './reconnect-strategy'
import type { RpcTransport } from './rpc-transport'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { rpcClientLogger } from '@frp-bridge/shared'
import { Heartbeat } from './heartbeat'
import { decodeControlMessage, encodeControlMessage } from './message'
import { Outbox } from './outbox'

export interface RpcClientOptions {
  selfNodeId: string
  selfApi: FrpControlApi
  token: string
  transport: RpcTransport
  reconnect?: ReconnectStrategy
  outbox?: Outbox
  heartbeatIntervalMs?: number
  defaultTimeoutMs?: number
}

interface PendingEntry {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

export class RpcClient extends EventEmitter {
  private readonly transport: RpcTransport
  private readonly heartbeat: Heartbeat
  private readonly outbox: Outbox
  private readonly reconnect?: ReconnectStrategy
  private readonly pending = new Map<string, PendingEntry>()
  private readonly defaultTimeoutMs: number
  private reconnectAttempt = 0
  private manualClose = false

  constructor(private readonly opts: RpcClientOptions) {
    super()
    this.transport = opts.transport
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000
    this.outbox = opts.outbox ?? new Outbox()
    this.reconnect = opts.reconnect
    this.heartbeat = new Heartbeat(this.transport, opts.heartbeatIntervalMs ?? 15_000)

    this.transport.on('message', (raw: string) => this.handleMessage(raw))
    this.transport.on('close', () => this.handleClose())
    this.transport.on('error', (err: Error) => this.emit('error', err))
  }

  async connect(): Promise<void> {
    this.manualClose = false
    await this.transport.connect()
    this.heartbeat.start()
    await this.sendRegister()
    await this.outbox.flushAll(msg => this.transport.send(encodeControlMessage(msg)))
    await this.pushSnapshot()
    this.reconnectAttempt = 0
    this.emit('open')
  }

  async disconnect(): Promise<void> {
    this.manualClose = true
    this.heartbeat.stop()
    await this.transport.close()
  }

  isOnline(): boolean {
    return this.transport.isOpen()
  }

  /** 发一条 command 到 target（可能是 S 自己，也可能是经 S 中继的其他 peer） */
  async sendCommand<T = unknown>(input: {
    target: string
    action: string
    payload: unknown[]
    timeoutMs?: number
  }): Promise<T> {
    if (!this.isOnline()) {
      // 离线 → 入 outbox，立即失败
      const msg: CommandMessage = {
        type: 'command',
        id: randomUUID(),
        target: input.target,
        action: input.action,
        payload: input.payload,
        originatorId: this.opts.selfNodeId,
        timeoutMs: input.timeoutMs
      }
      await this.outbox.enqueue(msg)
      throw new Error(`client offline, command enqueued (id=${msg.id})`)
    }

    const id = randomUUID()
    const msg: CommandMessage = {
      type: 'command',
      id,
      target: input.target,
      action: input.action,
      payload: input.payload,
      originatorId: this.opts.selfNodeId,
      timeoutMs: input.timeoutMs
    }

    return await new Promise<T>((resolve, reject) => {
      const timeoutMs = input.timeoutMs ?? this.defaultTimeoutMs
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`command "${input.action}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      this.pending.set(id, { resolve: v => resolve(v as T), reject, timer })

      this.transport.send(encodeControlMessage(msg)).catch((err) => {
        const entry = this.pending.get(id)
        if (entry) {
          clearTimeout(entry.timer)
          this.pending.delete(id)
          reject(err)
        }
      })
    })
  }

  /** 把本节点产生的事件发给 S（S 会广播到其他 peer） */
  async sendEvent(evt: ControlEvent): Promise<void> {
    if (!this.isOnline())
      return
    const msg: EventMessage = { type: 'event', event: evt }
    await this.transport.send(encodeControlMessage(msg)).catch(() => { /* swallow */ })
  }

  private async sendRegister(): Promise<void> {
    const msg: RegisterMessage = {
      type: 'register',
      id: randomUUID(),
      payload: {
        nodeId: this.opts.selfNodeId,
        token: this.opts.token,
        capabilities: []
      }
    }
    await this.transport.send(encodeControlMessage(msg))
  }

  private async pushSnapshot(): Promise<void> {
    try {
      const tunnels = await this.opts.selfApi.tunnel.list()
      const payload: TunnelSnapshotPayload = {
        nodeId: this.opts.selfNodeId,
        tunnels
      }
      const msg: SnapshotMessage = {
        type: 'snapshot',
        id: randomUUID(),
        action: 'tunnel.list',
        payload
      }
      await this.transport.send(encodeControlMessage(msg))
    }
    catch (err) {
      rpcClientLogger.warn('snapshot push failed', { err: (err as Error).message })
    }
  }

  private handleMessage(raw: string): void {
    let msg: ControlMessage
    try {
      msg = decodeControlMessage(raw)
    }
    catch (err) {
      this.emit('protocolError', err)
      return
    }

    switch (msg.type) {
      case 'ack':
        this.resolveAck(msg)
        break
      case 'event':
        // S 广播过来的事件 → 本节点 selfApi emit
        this.opts.selfApi.emit(msg.event)
        this.emit('event', msg.event)
        break
      case 'snapshot':
        // S 请求对账 → 回 snapshot（暂不支持，预留）
        break
      case 'ping': {
        const ping = msg as PingMessage
        const pong = { type: 'pong' as const, id: ping.id, ts: ping.ts, serverTs: Date.now() }
        void this.transport.send(encodeControlMessage(pong)).catch(() => { /* swallow */ })
        break
      }
      case 'pong':
        this.heartbeat.recordPong()
        break
      case 'command':
        rpcClientLogger.warn('unexpected command on client (should be relayed by S)', { id: msg.id })
        break
      case 'register':
        rpcClientLogger.warn('unexpected register on client')
        break
    }
  }

  private resolveAck(msg: AckMessage): void {
    const entry = this.pending.get(msg.id)
    if (!entry)
      return
    this.pending.delete(msg.id)
    clearTimeout(entry.timer)
    if (msg.status === 'failed') {
      entry.reject(new Error(msg.error?.message ?? 'command failed'))
    }
    else {
      entry.resolve(msg.result)
    }
  }

  private handleClose(): void {
    this.heartbeat.stop()
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('transport closed'))
      this.pending.delete(id)
    }
    this.emit('close')

    if (!this.manualClose && this.reconnect) {
      const attempt = this.reconnectAttempt++
      if (this.reconnect.shouldReconnect(attempt)) {
        const delay = this.reconnect.getDelay(attempt)
        setTimeout(() => {
          this.connect().catch((err) => {
            rpcClientLogger.warn('reconnect failed', { err: (err as Error).message, attempt })
          })
        }, delay)
      }
      else {
        this.reconnect.onMaxAttemptsReached?.()
      }
    }
  }
}

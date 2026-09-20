/**
 * Heartbeat — 周期性发送 ping，期望对端回 pong。
 */

import type { PingMessage } from '@frp-bridge/types'
import type { RpcTransport } from './rpc-transport'
import { randomUUID } from 'node:crypto'

export class Heartbeat {
  private timer?: NodeJS.Timeout
  private lastPongAt = 0

  constructor(
    private readonly transport: RpcTransport,
    private readonly intervalMs = 15_000
  ) {}

  start(): void {
    this.stop()
    this.lastPongAt = Date.now()
    this.timer = setInterval(() => {
      if (!this.transport.isOpen())
        return
      const msg: PingMessage = { type: 'ping', id: randomUUID(), ts: Date.now() }
      void this.transport.send(JSON.stringify(msg)).catch(() => { /* swallow */ })
    }, this.intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  recordPong(): void {
    this.lastPongAt = Date.now()
  }

  get lastPong(): number {
    return this.lastPongAt
  }
}

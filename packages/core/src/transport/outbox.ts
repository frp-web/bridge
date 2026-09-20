/**
 * Outbox — 离线命令暂存，重连后 flush。
 */

import type { ControlMessage } from '@frp-bridge/types'

export interface OutboxStorage {
  append: (msg: ControlMessage) => Promise<void> | void
  remove: (id: string) => Promise<void> | void
  loadAll: () => Promise<ControlMessage[]> | ControlMessage[]
}

export class Outbox {
  private queue: ControlMessage[] = []

  constructor(
    private readonly storage?: OutboxStorage,
    private readonly limit = 1000
  ) {}

  async restore(): Promise<void> {
    if (!this.storage)
      return
    const items = await this.storage.loadAll()
    this.queue = items.slice(-this.limit)
  }

  async enqueue(msg: ControlMessage): Promise<void> {
    this.queue.push(msg)
    if (this.queue.length > this.limit) {
      this.queue.shift()
    }
    await this.storage?.append(msg)
  }

  async flushAll(send: (msg: ControlMessage) => Promise<void>): Promise<void> {
    while (this.queue.length > 0) {
      const msg = this.queue.shift()!
      await send(msg)
      if ('id' in msg && typeof msg.id === 'string') {
        await this.storage?.remove(msg.id)
      }
    }
  }

  get size(): number {
    return this.queue.length
  }

  clear(): void {
    this.queue = []
  }
}

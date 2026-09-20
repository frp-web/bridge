/**
 * RpcTransport — abstract message transport.
 *
 * WebSocket is the only implementation (see impl/nuxt-websocket-transport.ts).
 * WebSocket 自带消息边界，因此 send/onMessage 直接以 string 为单位，
 * 不需要帧头 / 编解码层。
 *
 * 所有实现必须：
 *   - emit 'open' / 'message' / 'close' / 'error'
 *   - 提供幂等 connect() / close()
 */

import { EventEmitter } from 'node:events'

export type TransportState = 'idle' | 'connecting' | 'open' | 'closing' | 'closed'

export interface RpcTransport extends EventEmitter {
  connect: () => Promise<void>
  close: () => Promise<void>
  send: (data: string) => Promise<void>
  readonly state: TransportState
  isOpen: () => boolean
}

export abstract class BaseRpcTransport extends EventEmitter implements RpcTransport {
  protected _state: TransportState = 'idle'

  get state(): TransportState {
    return this._state
  }

  isOpen(): boolean {
    return this._state === 'open'
  }

  async connect(): Promise<void> {
    if (this._state === 'open' || this._state === 'connecting') {
      return
    }
    this._state = 'connecting'
    try {
      await this.openConnection()
      this.markOpen()
    }
    catch (err) {
      this._state = 'closed'
      this.emit('error', err)
      throw err
    }
  }

  async close(): Promise<void> {
    if (this._state === 'closed' || this._state === 'closing') {
      return
    }
    this._state = 'closing'
    try {
      await this.closeConnection()
    }
    finally {
      this._state = 'closed'
      this.emit('close')
    }
  }

  async send(data: string): Promise<void> {
    if (this._state !== 'open') {
      throw new Error(`Cannot send: transport state=${this._state}`)
    }
    await this.writeMessage(data)
  }

  protected markOpen(): void {
    if (this._state !== 'open') {
      this._state = 'open'
      this.emit('open')
    }
  }

  protected emitMessage(data: string): void {
    this.emit('message', data)
  }

  protected abstract openConnection(): Promise<void>
  protected abstract closeConnection(): Promise<void>
  protected abstract writeMessage(data: string): Promise<void>
}

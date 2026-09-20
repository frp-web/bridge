/**
 * NuxtWebSocketTransport — 唯一 RpcTransport 实现。
 *
 * - 客户端：包装 ws 库（Node 端），向 ws://host:3000/ws/rpc 出站
 * - 服务端：包装 Nuxt defineWebSocketHandler 的 Peer 对象
 *
 * WebSocket 自带消息边界，因此直接以 string 为单位收发，不需要帧编解码。
 */

import type { WebSocket } from 'ws'
import { BaseRpcTransport } from '../rpc-transport'

export interface NuxtWebSocketTransportOptions {
  url: string
}

/** 客户端：出站 WebSocket */
export class NuxtWebSocketTransport extends BaseRpcTransport {
  private ws: WebSocket | null = null

  constructor(private readonly opts: NuxtWebSocketTransportOptions) {
    super()
  }

  protected async openConnection(): Promise<void> {
    // 延迟 require，避免 Nuxt 服务端 bundle 时把 ws 库当作外部依赖
    const { WebSocket: WS } = await import('ws')
    const ws = new WS(this.opts.url)
    this.ws = ws

    await new Promise<void>((resolve, reject) => {
      let onOpen: (() => void) | null = null
      let onError: ((err: Error) => void) | null = null
      onOpen = (): void => {
        ws.off('error', onError!)
        resolve()
      }
      onError = (err: Error): void => {
        ws.off('open', onOpen!)
        reject(err)
      }
      ws.once('open', onOpen)
      ws.once('error', onError)
    })

    ws.on('message', (data) => {
      const text = typeof data === 'string' ? data : data.toString('utf8')
      this.emitMessage(text)
    })
    ws.on('close', () => {
      if (this._state !== 'closed') {
        this._state = 'closed'
        this.emit('close')
      }
    })
    ws.on('error', (err) => {
      this.emit('error', err)
    })
  }

  protected async writeMessage(data: string): Promise<void> {
    if (!this.ws)
      throw new Error('WebSocket not connected')
    const ws = this.ws
    await new Promise<void>((resolve, reject) => {
      ws.send(data, (err?: Error) => (err ? reject(err) : resolve()))
    })
  }

  protected async closeConnection(): Promise<void> {
    const ws = this.ws
    this.ws = null
    if (!ws)
      return
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve())
      try {
        ws.close()
      }
      catch {
        resolve()
      }
    })
  }
}

/**
 * NuxtServerPeerTransport — 服务端侧，包装 crossws Peer。
 *
 * Nuxt `defineWebSocketHandler` 提供的 `peer` 对象有 `send(data)` 和
 * `close()` 方法，且消息已经以 text 形式回调到 `message(peer, message)`。
 * 这个类仅做接口适配，不管理底层 socket 生命周期。
 */
export interface CrosswsPeerLike {
  send: (data: string) => void
  close: () => void
}

export class NuxtServerPeerTransport extends BaseRpcTransport {
  constructor(private readonly peer: CrosswsPeerLike) {
    super()
  }

  /** 服务端 peer 在 handler 'open' 回调里构造后立即标记 open */
  markPeerOpen(): void {
    this.markOpen()
  }

  handlePeerMessage(text: string): void {
    this.emitMessage(text)
  }

  handlePeerClose(): void {
    if (this._state !== 'closed') {
      this._state = 'closed'
      this.emit('close')
    }
  }

  handlePeerError(err: Error): void {
    this.emit('error', err)
  }

  protected async openConnection(): Promise<void> {
    this.markOpen()
  }

  protected async writeMessage(data: string): Promise<void> {
    this.peer.send(data)
  }

  protected async closeConnection(): Promise<void> {
    try {
      this.peer.close()
    }
    catch {
      /* swallow */
    }
  }
}

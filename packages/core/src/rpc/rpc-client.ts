import type { NodeInfo, RpcRequest } from '@frp-bridge/types'
import type { ReconnectStrategy } from './reconnect-strategy'
import { WebSocket } from 'ws'
import { isPingMessage, isRpcRequest } from './message-types'
import { ExponentialBackoffStrategy } from './reconnect-strategy'
import { safeParse } from './utils'

export interface RpcClientOptions {
  url: string
  nodeId: string
  getRegisterPayload: () => Promise<NodeInfo> | NodeInfo
  handleRequest: (req: RpcRequest) => Promise<unknown>
  reconnectStrategy?: ReconnectStrategy
  logger?: {
    info?: (msg: string, data?: unknown) => void
    warn?: (msg: string, data?: unknown) => void
    error?: (msg: string, data?: unknown) => void
  }
}

export class RpcClient {
  private ws: WebSocket | null = null
  private reconnectTimer?: NodeJS.Timeout
  private reconnectAttempt = 0
  private readonly reconnectStrategy: ReconnectStrategy

  constructor(private readonly options: RpcClientOptions) {
    this.reconnectStrategy = options.reconnectStrategy ?? new ExponentialBackoffStrategy()
  }

  async connect(): Promise<void> {
    this.reconnectAttempt = 0
    await this.createConnection()
  }

  disconnect(): void {
    this.reconnectTimer && clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.ws?.close()
    this.ws = null
  }

  private async createConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.options.url)
      this.ws = ws

      ws.on('open', async () => {
        try {
          const payload = await this.options.getRegisterPayload()
          this.send({ type: 'register', nodeId: this.options.nodeId, payload })
          this.reconnectAttempt = 0 // Reset on successful connection
          resolve()
        }
        catch (error) {
          this.options.logger?.error?.('rpc client register failed', error)
          reject(error)
        }
      })

      ws.on('message', (data: WebSocket.RawData) => {
        this.handleMessage(data).catch((error) => {
          this.options.logger?.error?.('rpc client handle message failed', error)
        })
      })

      ws.on('close', () => {
        this.scheduleReconnect()
      })

      ws.on('error', (error: Error) => {
        this.options.logger?.warn?.('rpc client socket error', error)
        this.scheduleReconnect()
        reject(error)
      })
    })
  }

  private async handleMessage(data: WebSocket.RawData): Promise<void> {
    const msg = safeParse(data, this.options.logger)
    if (!msg) {
      return
    }

    if (isPingMessage(msg)) {
      this.send({ type: 'pong' as const, timestamp: Date.now() })
      return
    }

    if (isRpcRequest(msg)) {
      await this.handleRpcRequest(msg)
    }
  }

  private async handleRpcRequest(req: RpcRequest): Promise<void> {
    try {
      const result = await this.options.handleRequest(req)
      this.send({ id: req.id, status: 'success', result })
    }
    catch (error) {
      this.send({
        id: req.id,
        status: 'error',
        error: { code: 'EXECUTION_ERROR', message: error instanceof Error ? error.message : 'Unknown error' }
      })
    }
  }

  private send(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return
    }

    // Check if should reconnect
    if (!this.reconnectStrategy.shouldReconnect(this.reconnectAttempt)) {
      this.reconnectStrategy.onMaxAttemptsReached()
      return
    }

    const delay = this.reconnectStrategy.getDelay(this.reconnectAttempt)
    this.reconnectAttempt++

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.createConnection().catch((error) => {
        this.options.logger?.error?.('rpc client reconnect failed', error)
        this.scheduleReconnect()
      })
    }, delay)

    this.options.logger?.info?.(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`)
  }
}

import type { NodeInfo, RpcRequest } from '@frp-bridge/types'
import { WebSocket } from 'ws'
import { safeParse } from './utils'

export interface RpcClientOptions {
  url: string
  nodeId: string
  getRegisterPayload: () => Promise<NodeInfo> | NodeInfo
  handleRequest: (req: RpcRequest) => Promise<unknown>
  reconnectInterval?: number
  logger?: {
    info?: (msg: string, data?: unknown) => void
    warn?: (msg: string, data?: unknown) => void
    error?: (msg: string, data?: unknown) => void
  }
}

export class RpcClient {
  private ws: WebSocket | null = null
  private reconnectTimer?: NodeJS.Timeout
  private readonly reconnectInterval: number

  constructor(private readonly options: RpcClientOptions) {
    this.reconnectInterval = options.reconnectInterval ?? 5000
  }

  async connect(): Promise<void> {
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

    if (msg.type === 'ping') {
      this.send({ type: 'pong', timestamp: Date.now() })
      return
    }

    if (msg.method) {
      await this.handleRpcRequest(msg as RpcRequest)
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
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.createConnection().catch((error) => {
        this.options.logger?.error?.('rpc client reconnect failed', error)
        this.scheduleReconnect()
      })
    }, this.reconnectInterval)
  }
}

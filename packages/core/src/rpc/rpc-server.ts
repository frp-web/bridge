import type { NodeInfo, RpcRequest, RpcResponse } from '@frp-bridge/types'
import type { IncomingMessage } from 'node:http'
import type { RegisterMessage } from './message-types'
import { randomUUID } from 'node:crypto'
import { WebSocket, WebSocketServer } from 'ws'
import { isPongMessage, isRegisterMessage, isRpcResponse } from './message-types'
import { safeParse } from './utils'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timer: NodeJS.Timeout
}

export interface RpcServerOptions {
  port: number
  heartbeatInterval?: number
  logger?: {
    info?: (msg: string, data?: unknown) => void
    warn?: (msg: string, data?: unknown) => void
    error?: (msg: string, data?: unknown) => void
  }
  validateToken?: (token: string | undefined, nodeId: string | undefined) => boolean | Promise<boolean>
  authorize?: (nodeId: string, method: string) => boolean | Promise<boolean>
  onRegister?: (nodeId: string, payload: NodeInfo) => void | Promise<void>
}

export class RpcServer {
  private readonly clients = new Map<string, WebSocket>()
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private readonly wsToNode = new Map<WebSocket, string>()
  private heartbeatTimer?: NodeJS.Timeout
  private server?: WebSocketServer

  constructor(private readonly options: RpcServerOptions) {}

  start(): void {
    if (this.server) {
      return
    }

    this.server = new WebSocketServer({ port: this.options.port })
    this.server.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      const params = new URL(request.url ?? '/', 'ws://localhost').searchParams
      const token = params.get('token') ?? undefined
      ws.on('message', (data: WebSocket.RawData) => {
        this.handleMessage(ws, data, token).catch((error) => {
          this.options.logger?.error?.('rpc server handle message failed', error)
        })
      })
      ws.on('close', () => {
        this.handleClose(ws)
      })
    })

    this.startHeartbeat()
    this.options.logger?.info?.('RpcServer started', { port: this.options.port })
  }

  stop(): void {
    this.heartbeatTimer && clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined

    this.pendingRequests.forEach(p => clearTimeout(p.timer))
    this.pendingRequests.clear()

    this.clients.forEach(ws => ws.close())
    this.clients.clear()
    this.wsToNode.clear()

    this.server?.close()
    this.server = undefined
  }

  async rpcCall(nodeId: string, method: string, params: Record<string, unknown>, timeout = 30000): Promise<unknown> {
    const ws = this.clients.get(nodeId)
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Client not connected')
    }

    if (this.options.authorize) {
      const allowed = await this.options.authorize(nodeId, method)
      if (!allowed) {
        throw new Error('UNAUTHORIZED')
      }
    }

    const id = randomUUID()
    const request: RpcRequest = { id, method, params, timeout }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, timeout)

      this.pendingRequests.set(id, { resolve, reject, timer })
      ws.send(JSON.stringify(request))
    })
  }

  private async handleMessage(ws: WebSocket, data: WebSocket.RawData, token?: string): Promise<void> {
    const msg = safeParse(data, this.options.logger)
    if (!msg) {
      return
    }

    if (isRegisterMessage(msg)) {
      await this.handleRegister(ws, msg, token)
      return
    }

    if (isPongMessage(msg)) {
      return
    }

    if (isRpcResponse(msg)) {
      this.handleRpcResponse(msg)
    }
  }

  private async handleRegister(ws: WebSocket, msg: RegisterMessage, token?: string): Promise<void> {
    const { nodeId } = msg
    if (!nodeId) {
      ws.close()
      return
    }

    const allowed = this.options.validateToken ? await this.options.validateToken(token, nodeId) : true
    if (!allowed) {
      ws.close()
      return
    }

    this.clients.set(nodeId, ws)
    this.wsToNode.set(ws, nodeId)

    const payload = msg.payload as unknown
    if (payload && this.options.onRegister) {
      await this.options.onRegister(nodeId, payload as NodeInfo)
    }
  }

  private handleRpcResponse(msg: RpcResponse): void {
    const pending = this.pendingRequests.get(msg.id)
    if (!pending) {
      return
    }
    clearTimeout(pending.timer)
    this.pendingRequests.delete(msg.id)
    if (msg.status === 'success') {
      pending.resolve(msg.result)
    }
    else {
      pending.reject(new Error(msg.error?.message ?? 'RPC error'))
    }
  }

  private handleClose(ws: WebSocket): void {
    const nodeId = this.wsToNode.get(ws)
    if (nodeId) {
      this.clients.delete(nodeId)
      this.wsToNode.delete(ws)
    }
  }

  private startHeartbeat(): void {
    const interval = this.options.heartbeatInterval ?? 30000
    this.heartbeatTimer = setInterval(() => {
      this.clients.forEach((client, nodeId) => {
        if (client.readyState === WebSocket.OPEN) {
          const payload = { type: 'ping', timestamp: Date.now() }
          client.send(JSON.stringify(payload))
        }
        else {
          this.clients.delete(nodeId)
        }
      })
    }, interval)
  }
}

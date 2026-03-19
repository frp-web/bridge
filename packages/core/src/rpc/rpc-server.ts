import type { NodeInfo, RpcRequest, RpcResponse } from '@frp-bridge/types'
import type { IncomingMessage } from 'node:http'
import type { RuntimeLogger } from '../runtime'
import type { EventRpcMessage, RegisterMessage } from './message-types'
import { randomUUID } from 'node:crypto'
import { createLogger } from '@frp-bridge/shared'
import { WebSocket, WebSocketServer } from 'ws'
import { isEventMessage, isPongMessage, isRegisterMessage, isRpcResponse } from './message-types'
import { safeParse } from './utils'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timer: NodeJS.Timeout
}

/**
 * Command status for tracking
 */
export interface RpcCommandStatus {
  commandId: string
  nodeId: string
  action: string
  status: 'pending' | 'completed' | 'failed'
  result?: unknown
  error?: string
  timestamp: number
}

export interface RpcServerOptions {
  port: number
  heartbeatInterval?: number
  validateToken?: (token: string | undefined, nodeId: string | undefined) => boolean | Promise<boolean>
  authorize?: (nodeId: string, method: string) => boolean | Promise<boolean>
  onRegister?: (nodeId: string, payload: NodeInfo) => void | Promise<void>
  onEvent?: (nodeId: string, event: EventRpcMessage) => void | Promise<void>
  commandTimeout?: number // Default timeout for command tracking
  logger?: Partial<RuntimeLogger>
}

export class RpcServer {
  private readonly clients = new Map<string, WebSocket>()
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private readonly commandStatuses = new Map<string, RpcCommandStatus>()
  private readonly commandTimers = new Map<string, NodeJS.Timeout>()
  private readonly wsToNode = new Map<WebSocket, string>()
  private heartbeatTimer?: NodeJS.Timeout
  private cleanupTimer?: NodeJS.Timeout
  private server?: WebSocketServer
  private readonly defaultCommandTimeout: number
  private readonly log = createLogger('RpcServer')

  constructor(private readonly options: RpcServerOptions) {
    this.defaultCommandTimeout = options.commandTimeout ?? 60000

    // Auto-cleanup old statuses every 10 minutes
    this.cleanupTimer = setInterval(() => {
      this.clearOldStatuses()
    }, 10 * 60 * 1000)
  }

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
          this.log.error('rpc server handle message failed', { error })
        })
      })
      ws.on('close', () => {
        this.handleClose(ws)
      })
    })

    this.startHeartbeat()
    this.log.success('RpcServer started', { port: this.options.port })
  }

  stop(): void {
    // Clear timers
    this.heartbeatTimer && clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined

    this.cleanupTimer && clearInterval(this.cleanupTimer)
    this.cleanupTimer = undefined

    // Clear pending request timers
    this.pendingRequests.forEach(p => clearTimeout(p.timer))
    this.pendingRequests.clear()

    // Clear command timers
    this.commandTimers.forEach(t => clearTimeout(t))
    this.commandTimers.clear()

    // Close connections
    this.clients.forEach(ws => ws.close())
    this.clients.clear()
    this.wsToNode.clear()
    this.commandStatuses.clear()

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

  /**
   * Send event-based message to a specific node (matching document spec)
   */
  sendToNode(nodeId: string, message: EventRpcMessage): boolean {
    const ws = this.clients.get(nodeId)
    if (!ws) {
      this.log.error(`Node not found: ${nodeId}`)
      return false
    }

    if (ws.readyState !== WebSocket.OPEN) {
      this.log.error(`Node not ready: ${nodeId}`)
      return false
    }

    try {
      ws.send(JSON.stringify(message))

      // Track command status if it's a command with ID
      if (message.type === 'command' && message.id) {
        this.commandStatuses.set(message.id, {
          commandId: message.id,
          nodeId,
          action: message.action,
          status: 'pending',
          timestamp: Date.now()
        })

        // Clear existing timer if any
        const existingTimer = this.commandTimers.get(message.id)
        if (existingTimer) {
          clearTimeout(existingTimer)
        }

        // Set timeout to mark as failed if no response (with timer tracking for cleanup)
        const timer = setTimeout(() => {
          this.commandTimers.delete(message.id!)
          const status = this.commandStatuses.get(message.id!)
          if (status && status.status === 'pending') {
            status.status = 'failed'
            status.error = 'Command timeout'
            this.log.warn(`Command ${message.id} (${message.action}) timeout`)
          }
        }, this.defaultCommandTimeout)
        this.commandTimers.set(message.id, timer)
      }

      return true
    }
    catch (error) {
      this.log.error(`Send failed to ${nodeId}:`, { error })
      return false
    }
  }

  /**
   * Broadcast event-based message to all connected nodes
   */
  broadcast(message: EventRpcMessage): void {
    const data = JSON.stringify(message)
    let successCount = 0
    let failCount = 0

    for (const [nodeId, ws] of this.clients.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data)
          successCount++
        }
        catch (error) {
          this.log.error(`Broadcast failed to ${nodeId}:`, { error })
          failCount++
        }
      }
    }

    this.log.info('Broadcast completed', {
      total: this.clients.size,
      success: successCount,
      failed: failCount
    })
  }

  /**
   * Get list of all online node IDs
   */
  getOnlineNodes(): string[] {
    return Array.from(this.clients.keys())
  }

  /**
   * Check if a specific node is online
   */
  isNodeOnline(nodeId: string): boolean {
    const ws = this.clients.get(nodeId)
    return ws !== undefined && ws.readyState === WebSocket.OPEN
  }

  /**
   * Get the count of online nodes
   */
  getOnlineNodeCount(): number {
    let count = 0
    for (const ws of this.clients.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        count++
      }
    }
    return count
  }

  /**
   * Get command status by ID
   */
  getRpcCommandStatus(commandId: string): RpcCommandStatus | undefined {
    return this.commandStatuses.get(commandId)
  }

  /**
   * Get all command statuses
   */
  getAllRpcCommandStatuses(): RpcCommandStatus[] {
    return Array.from(this.commandStatuses.values())
  }

  /**
   * Clear completed/failed command statuses older than specified milliseconds
   */
  clearOldStatuses(maxAge = 300000): void { // Default 5 minutes
    const now = Date.now()
    for (const [id, status] of this.commandStatuses.entries()) {
      if (status.status !== 'pending' && (now - status.timestamp) > maxAge) {
        this.commandStatuses.delete(id)
        // Also cleanup associated timer
        const timer = this.commandTimers.get(id)
        if (timer) {
          clearTimeout(timer)
          this.commandTimers.delete(id)
        }
      }
    }
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

    // Handle Event-based messages (from client)
    if (isEventMessage(msg)) {
      await this.handleEventMessage(ws, msg)
      return
    }

    if (isRpcResponse(msg)) {
      this.handleRpcResponse(msg)
    }
  }

  /**
   * Handle event-based messages from clients
   */
  private async handleEventMessage(ws: WebSocket, msg: EventRpcMessage): Promise<void> {
    const nodeId = this.wsToNode.get(ws)
    if (!nodeId) {
      this.log.warn('Received event from unregistered client')
      return
    }

    this.log.info(`Event from ${nodeId}`, {
      action: msg.action,
      payload: msg.payload
    })

    // Update command status if this event references a command
    if (msg.id) {
      const status = this.commandStatuses.get(msg.id)
      if (status) {
        const payload = msg.payload as { success?: boolean, error?: string, result?: unknown }
        status.status = payload?.success ? 'completed' : 'failed'
        status.result = payload?.result
        status.error = payload?.error
      }
    }

    // Call registered event handler if provided
    if (this.options.onEvent) {
      await this.options.onEvent(nodeId, msg)
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
      this.log.warn(`Node ${nodeId} rejected: invalid token`)
      ws.close()
      return
    }

    this.clients.set(nodeId, ws)
    this.wsToNode.set(ws, nodeId)

    this.log.success(`Node connected: ${nodeId}`)

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
      this.log.info(`Node disconnected: ${nodeId}`)
    }
  }

  private startHeartbeat(): void {
    const interval = this.options.heartbeatInterval ?? 30000
    this.heartbeatTimer = setInterval(() => {
      // Collect disconnected nodes first, then delete them
      // to avoid modifying Map during iteration
      const disconnected: string[] = []
      const payload = { type: 'ping', timestamp: Date.now() }

      this.clients.forEach((client, nodeId) => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(JSON.stringify(payload))
          }
          catch (error) {
            this.log.warn(`Failed to send ping to ${nodeId}:`, { error })
            disconnected.push(nodeId)
          }
        }
        else {
          disconnected.push(nodeId)
        }
      })

      // Remove disconnected clients
      for (const nodeId of disconnected) {
        this.clients.delete(nodeId)
        this.log.info(`Node ${nodeId} disconnected (heartbeat)`)
      }
    }, interval)
  }
}

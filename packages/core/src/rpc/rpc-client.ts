import type { NodeInfo, RpcRequest } from '@frp-bridge/types'
import type { CommandRpcMessage, EventRpcMessageEvent } from './message-types'
import type { ReconnectStrategy } from './reconnect-strategy'
import { rpcClientLogger } from '@frp-bridge/shared'
import { WebSocket } from 'ws'
import { isCommandMessage, isPingMessage, isRpcRequest } from './message-types'
import { ExponentialBackoffStrategy } from './reconnect-strategy'
import { safeParse } from './utils'

export interface RpcClientOptions {
  url: string
  nodeId: string
  getRegisterPayload: () => Promise<NodeInfo> | NodeInfo
  handleRequest: (req: RpcRequest) => Promise<unknown>
  handleCommand?: (command: CommandRpcMessage) => Promise<unknown>
  reconnectStrategy?: ReconnectStrategy
}

export class RpcClient {
  private ws: WebSocket | null = null
  private reconnectTimer?: NodeJS.Timeout
  private reconnectAttempt = 0
  private readonly reconnectStrategy: ReconnectStrategy
  private connectionState: 'connecting' | 'connected' | 'disconnected' = 'disconnected'
  private readonly log = rpcClientLogger

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
    this.connectionState = 'disconnected'
    this.log.info('Disconnected from server')
  }

  /**
   * Get current connection state
   */
  getConnectionState(): 'connecting' | 'connected' | 'disconnected' {
    return this.connectionState
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connectionState === 'connected' && this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * Send an event message to server (matching document spec)
   */
  sendEvent(event: EventRpcMessageEvent): boolean {
    if (!this.isConnected()) {
      this.log.warn('Not connected, cannot send event')
      return false
    }

    try {
      this.send(event)
      return true
    }
    catch (error) {
      this.log.error('Send event error:', { error })
      return false
    }
  }

  private async createConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.options.url)
      this.ws = ws
      this.connectionState = 'connecting'

      ws.on('open', async () => {
        try {
          const payload = await this.options.getRegisterPayload()
          this.send({ type: 'register', nodeId: this.options.nodeId, payload })
          this.connectionState = 'connected'
          this.reconnectAttempt = 0 // Reset on successful connection
          this.log.success(`Connected to server as ${this.options.nodeId}`)
          resolve()
        }
        catch (error) {
          this.connectionState = 'disconnected'
          this.log.error('rpc client register failed', { error })
          reject(error)
        }
      })

      ws.on('message', (data: WebSocket.RawData) => {
        this.handleMessage(data).catch((error) => {
          this.log.error('rpc client handle message failed', { error })
        })
      })

      ws.on('close', () => {
        this.connectionState = 'disconnected'
        this.log.info('Connection closed, scheduling reconnect')
        this.scheduleReconnect()
      })

      ws.on('error', (error: Error) => {
        this.log.warn('rpc client socket error', { error })
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

    // Handle event-based command messages (matching document spec)
    if (isCommandMessage(msg)) {
      await this.handleCommandEvent(msg)
      return
    }

    if (isRpcRequest(msg)) {
      await this.handleRpcRequest(msg)
    }
  }

  /**
   * Handle event-based command messages from server (matching document spec)
   */
  private async handleCommandEvent(command: CommandRpcMessage): Promise<void> {
    this.log.info(`Received command: ${command.action}`)

    try {
      // Call custom command handler if provided
      if (this.options.handleCommand) {
        const result = await this.options.handleCommand(command)

        // Send event response (matching document spec)
        const event: EventRpcMessageEvent = {
          type: 'event',
          action: `${command.action}ed` as EventRpcMessageEvent['action'], // Convert to past tense: tunnel.add -> tunnel.added
          payload: {
            success: true,
            result
          },
          id: command.id
        }
        this.send(event)
      }
      else {
        // Fallback: send error response if no handler
        const event: EventRpcMessageEvent = {
          type: 'event',
          action: `${command.action}ed` as EventRpcMessageEvent['action'],
          payload: {
            success: false,
            error: 'No command handler registered'
          },
          id: command.id
        }
        this.send(event)
      }
    }
    catch (error) {
      // Send error event response
      const event: EventRpcMessageEvent = {
        type: 'event',
        action: `${command.action}ed` as EventRpcMessageEvent['action'],
        payload: {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        },
        id: command.id
      }
      this.send(event)
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

  private send(message: Record<string, unknown>): void {
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
      this.log.error('Max reconnection attempts reached')
      return
    }

    const delay = this.reconnectStrategy.getDelay(this.reconnectAttempt)
    this.reconnectAttempt++

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.createConnection().catch((error) => {
        this.log.error('rpc client reconnect failed', { error })
        this.scheduleReconnect()
      })
    }, delay)

    this.log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`)
  }
}

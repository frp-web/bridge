/**
 * Node Manager for server-side node management
 * Handles node registration, heartbeat, and queries
 */

import type {
  NodeHeartbeatPayload,
  NodeInfo,
  NodeListQuery,
  NodeListResponse,
  NodeRegisterPayload,
  NodeStatistics
} from '@frp-bridge/types'
import type { RuntimeContext } from '../runtime'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'

export interface NodeManagerOptions {
  heartbeatTimeout?: number // ms, default 90s
  logger?: any // RuntimeLogger
}

export interface NodeStorage {
  save: (node: NodeInfo) => Promise<void> | void
  delete: (id: string) => Promise<void> | void
  load: (id: string) => Promise<NodeInfo | undefined> | NodeInfo | undefined
  list: () => Promise<NodeInfo[]> | NodeInfo[]
}

export type NodeEvent =
  | 'node:registered'
  | 'node:heartbeat'
  | 'node:unregistered'
  | 'node:statusChanged'

/**
 * Manages nodes in server mode
 * Stores node info, handles heartbeat, emits events
 */
export class NodeManager extends EventEmitter {
  private nodes = new Map<string, NodeInfo>()
  private heartbeatTimers = new Map<string, NodeJS.Timeout>()
  private storage?: NodeStorage
  private heartbeatTimeout: number
  private logger?: any

  constructor(
    private context: RuntimeContext,
    options: NodeManagerOptions = {},
    storage?: NodeStorage
  ) {
    super()
    this.heartbeatTimeout = options.heartbeatTimeout ?? 90000
    this.logger = options.logger
    this.storage = storage
  }

  async initialize(): Promise<void> {
    // Load persisted nodes if storage exists
    if (this.storage) {
      try {
        const persistedNodes = await this.storage.list()
        for (const node of persistedNodes) {
          this.nodes.set(node.id, node)
          this.setupHeartbeatTimer(node.id)
        }
        this.logger?.info?.(`Loaded ${persistedNodes.length} nodes from storage`)
      }
      catch (error) {
        this.logger?.error?.('Failed to load nodes from storage', { error })
      }
    }
  }

  async dispose(): Promise<void> {
    // Clear all heartbeat timers
    for (const timer of this.heartbeatTimers.values()) {
      clearTimeout(timer)
    }
    this.heartbeatTimers.clear()
  }

  /** Register a new node (called when client connects) */
  async registerNode(payload: NodeRegisterPayload): Promise<NodeInfo> {
    const now = Date.now()
    const nodeId = randomUUID()

    const nodeInfo: NodeInfo = {
      id: nodeId,
      ip: payload.ip,
      port: payload.port,
      protocol: payload.protocol,
      serverAddr: payload.serverAddr,
      serverPort: payload.serverPort,
      hostname: payload.hostname,
      osType: payload.osType,
      osRelease: payload.osRelease,
      platform: payload.platform,
      cpuCores: payload.cpuCores,
      memTotal: payload.memTotal,
      frpVersion: payload.frpVersion,
      bridgeVersion: payload.bridgeVersion,
      token: payload.token,
      status: 'online',
      connectedAt: now,
      lastHeartbeat: now,
      createdAt: now,
      updatedAt: now
    }

    this.nodes.set(nodeId, nodeInfo)
    this.setupHeartbeatTimer(nodeId)

    // Persist if storage available
    if (this.storage) {
      try {
        await this.storage.save(nodeInfo)
      }
      catch (error) {
        this.logger?.error?.('Failed to save node', { nodeId, error })
      }
    }

    this.emit('node:registered', {
      type: 'node:registered',
      timestamp: now,
      payload: { nodeId, nodeInfo }
    })

    return nodeInfo
  }

  /** Update node heartbeat and status */
  async updateHeartbeat(payload: NodeHeartbeatPayload): Promise<void> {
    const node = this.nodes.get(payload.nodeId)
    if (!node)
      return

    const oldStatus = node.status
    const now = Date.now()

    node.status = payload.status
    node.lastHeartbeat = now
    node.updatedAt = now

    if (payload.cpuCores !== undefined) {
      node.cpuCores = payload.cpuCores
    }
    if (payload.memTotal !== undefined) {
      node.memTotal = payload.memTotal
    }

    // Reset heartbeat timer
    this.setupHeartbeatTimer(payload.nodeId)

    // Persist if storage available
    if (this.storage) {
      try {
        await this.storage.save(node)
      }
      catch (error) {
        this.logger?.error?.('Failed to save node heartbeat', { nodeId: payload.nodeId, error })
      }
    }

    // Emit heartbeat event
    this.emit('node:heartbeat', {
      type: 'node:heartbeat',
      timestamp: now,
      payload: { nodeId: payload.nodeId }
    })

    // Emit status change event if status changed
    if (oldStatus !== payload.status) {
      this.emit('node:statusChanged', {
        type: 'node:statusChanged',
        timestamp: now,
        payload: { nodeId: payload.nodeId, oldStatus, newStatus: payload.status }
      })
    }
  }

  /** Unregister a node (called when client disconnects) */
  async unregisterNode(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId)
    if (!node)
      return

    const now = Date.now()

    this.nodes.delete(nodeId)
    this.clearHeartbeatTimer(nodeId)

    // Delete from storage if available
    if (this.storage) {
      try {
        await this.storage.delete(nodeId)
      }
      catch (error) {
        this.logger?.error?.('Failed to delete node', { nodeId, error })
      }
    }

    this.emit('node:unregistered', {
      type: 'node:unregistered',
      timestamp: now,
      payload: { nodeId }
    })
  }

  /** Get node by id */
  async getNode(id: string): Promise<NodeInfo | undefined> {
    return this.nodes.get(id)
  }

  /** List nodes with pagination and filtering */
  async listNodes(query?: NodeListQuery): Promise<NodeListResponse> {
    const page = query?.page ?? 1
    const pageSize = query?.pageSize ?? 20
    const status = query?.status
    const search = query?.search?.toLowerCase()

    let items = Array.from(this.nodes.values())

    // Filter by status
    if (status) {
      items = items.filter(n => n.status === status)
    }

    // Filter by labels
    if (query?.labels) {
      items = items.filter((node) => {
        if (!node.labels)
          return false
        return Object.entries(query.labels!).every(([k, v]) => node.labels?.[k] === v)
      })
    }

    // Search by hostname, ip, or id
    if (search) {
      items = items.filter(n =>
        n.hostname?.toLowerCase().includes(search)
        || n.ip.toLowerCase().includes(search)
        || n.id.toLowerCase().includes(search)
      )
    }

    const total = items.length
    const start = (page - 1) * pageSize
    const end = start + pageSize
    const paginatedItems = items.slice(start, end)

    return {
      items: paginatedItems,
      total,
      page,
      pageSize,
      hasMore: end < total
    }
  }

  /** Get node statistics */
  async getStatistics(): Promise<NodeStatistics> {
    const nodes = Array.from(this.nodes.values())

    return {
      total: nodes.length,
      online: nodes.filter(n => n.status === 'online').length,
      offline: nodes.filter(n => n.status === 'offline').length,
      connecting: nodes.filter(n => n.status === 'connecting').length,
      error: nodes.filter(n => n.status === 'error').length
    }
  }

  /** Check if node exists */
  hasNode(id: string): boolean {
    return this.nodes.has(id)
  }

  /** Get all online nodes */
  getOnlineNodes(): NodeInfo[] {
    return Array.from(this.nodes.values()).filter(n => n.status === 'online')
  }

  /** Get all offline nodes */
  getOfflineNodes(): NodeInfo[] {
    return Array.from(this.nodes.values()).filter(n => n.status === 'offline')
  }

  /** Get nodes by status */
  getNodesByStatus(status: NodeInfo['status']): NodeInfo[] {
    return Array.from(this.nodes.values()).filter(n => n.status === status)
  }

  /** Setup heartbeat timer for a node */
  private setupHeartbeatTimer(nodeId: string): void {
    // Clear existing timer
    this.clearHeartbeatTimer(nodeId)

    // Set new timer
    const timer = setTimeout(() => {
      this.handleHeartbeatTimeout(nodeId)
    }, this.heartbeatTimeout)

    this.heartbeatTimers.set(nodeId, timer)
  }

  /** Clear heartbeat timer for a node */
  private clearHeartbeatTimer(nodeId: string): void {
    const timer = this.heartbeatTimers.get(nodeId)
    if (timer) {
      clearTimeout(timer)
      this.heartbeatTimers.delete(nodeId)
    }
  }

  /** Handle heartbeat timeout */
  private async handleHeartbeatTimeout(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId)
    if (!node)
      return

    const oldStatus = node.status
    node.status = 'offline'
    node.updatedAt = Date.now()

    if (this.storage) {
      try {
        await this.storage.save(node)
      }
      catch (error) {
        this.logger?.error?.('Failed to save node after timeout', { nodeId, error })
      }
    }

    this.emit('node:statusChanged', {
      type: 'node:statusChanged',
      timestamp: Date.now(),
      payload: { nodeId, oldStatus, newStatus: 'offline', reason: 'heartbeat_timeout' }
    })
  }
}

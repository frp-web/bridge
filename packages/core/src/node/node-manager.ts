/**
 * Node Manager for server-side node management
 * Handles node registration, heartbeat, tunnel registry, and queries
 */

import type {
  NodeHeartbeatPayload,
  NodeInfo,
  NodeListQuery,
  NodeListResponse,
  NodeRegisterPayload,
  NodeStatistics,
  ProxyConfig,
  TunnelSyncPayload
} from '@frp-bridge/types'
import type { RuntimeContext } from '../runtime'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { nodeManagerLogger } from '@frp-bridge/shared'

export interface NodeManagerOptions {
  heartbeatTimeout?: number // ms, default 90s
}

export interface NodeStorage {
  save: (node: NodeInfo) => Promise<void> | void
  delete: (id: string) => Promise<void> | void
  load: (id: string) => Promise<NodeInfo | undefined> | NodeInfo | undefined
  list: () => Promise<NodeInfo[]> | NodeInfo[]
}

export type NodeEvent
  = | 'node:registered'
    | 'node:heartbeat'
    | 'node:unregistered'
    | 'node:statusChanged'
    | 'tunnel:synced'

/**
 * Manages nodes in server mode
 * Stores node info, handles heartbeat, manages global tunnel registry, emits events
 */
export class NodeManager extends EventEmitter {
  private nodes = new Map<string, NodeInfo>()
  private heartbeatTimers = new Map<string, NodeJS.Timeout>()
  private tunnelRegistry = new Map<string, ProxyConfig[]>() // nodeId -> tunnels
  private storage?: NodeStorage
  private heartbeatTimeout: number
  private readonly log = nodeManagerLogger

  constructor(
    private context: RuntimeContext,
    options: NodeManagerOptions = {},
    storage?: NodeStorage
  ) {
    super()
    this.heartbeatTimeout = options.heartbeatTimeout ?? 90000
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
        this.log.info(`Loaded ${persistedNodes.length} nodes from storage`)
      }
      catch (error) {
        this.log.error('Failed to load nodes from storage', { error })
      }
    }
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
        this.log.error('Failed to save node', { nodeId, error })
      }
    }

    this.emit('node:registered', {
      type: 'node:registered',
      timestamp: now,
      payload: { nodeId, nodeInfo }
    })

    this.log.success('Node registered', { nodeId, hostname: payload.hostname, ip: payload.ip })
    return nodeInfo
  }

  /** Update node heartbeat and status */
  async updateHeartbeat(payload: NodeHeartbeatPayload): Promise<void> {
    const node = this.nodes.get(payload.nodeId)
    if (!node) {
      this.log.debug('Heartbeat for unknown node', { nodeId: payload.nodeId })
      return
    }

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
        this.log.error('Failed to save node heartbeat', { nodeId: payload.nodeId, error })
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
      this.log.info('Node status changed', { nodeId: payload.nodeId, oldStatus, newStatus: payload.status })
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
    if (!node) {
      this.log.debug('Attempted to unregister unknown node', { nodeId })
      return
    }

    const now = Date.now()

    this.nodes.delete(nodeId)
    this.clearHeartbeatTimer(nodeId)
    this.clearNodeTunnels(nodeId) // Clear tunnels when node disconnects

    // Delete from storage if available
    if (this.storage) {
      try {
        await this.storage.delete(nodeId)
      }
      catch (error) {
        this.log.error('Failed to delete node', { nodeId, error })
      }
    }

    this.emit('node:unregistered', {
      type: 'node:unregistered',
      timestamp: now,
      payload: { nodeId }
    })

    this.log.info('Node unregistered', { nodeId, hostname: node.hostname })
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
        this.log.error('Failed to save node after timeout', { nodeId, error })
      }
    }

    this.emit('node:statusChanged', {
      type: 'node:statusChanged',
      timestamp: Date.now(),
      payload: { nodeId, oldStatus, newStatus: 'offline', reason: 'heartbeat_timeout' }
    })

    this.log.warn('Node heartbeat timeout', { nodeId, hostname: node.hostname })
  }

  // ==================== Tunnel Registry Methods ====================

  /** Sync tunnels for a node (called when node connects or updates tunnels) */
  async syncTunnels(payload: TunnelSyncPayload): Promise<void> {
    const { nodeId, tunnels, timestamp } = payload
    const node = this.nodes.get(nodeId)

    if (!node) {
      this.log.warn('Tunnel sync failed: node not found', { nodeId })
      return
    }

    // Update tunnel registry
    this.tunnelRegistry.set(nodeId, tunnels)

    // Update node info
    node.tunnels = tunnels
    node.updatedAt = timestamp

    // Persist if storage available
    if (this.storage) {
      try {
        await this.storage.save(node)
      }
      catch (error) {
        this.log.error('Failed to save node after tunnel sync', { nodeId, error })
      }
    }

    this.emit('tunnel:synced', {
      type: 'tunnel:synced',
      timestamp: Date.now(),
      payload: { nodeId, tunnelCount: tunnels.length }
    })

    this.log.success('Tunnels synced for node', { nodeId, tunnelCount: tunnels.length })
  }

  /** Get tunnels for a specific node */
  getNodeTunnels(nodeId: string): ProxyConfig[] {
    return this.tunnelRegistry.get(nodeId) || []
  }

  /** Get all tunnels across all nodes */
  getAllTunnels(): Map<string, ProxyConfig[]> {
    return new Map(this.tunnelRegistry)
  }

  /** Check if a remotePort is in use across all nodes (for conflict detection) */
  isRemotePortInUse(remotePort: number, excludeNodeId?: string): { inUse: boolean, nodeId?: string, tunnelName?: string } {
    for (const [nodeId, tunnels] of this.tunnelRegistry.entries()) {
      // Skip the node we're checking (for update operations)
      if (excludeNodeId && nodeId === excludeNodeId) {
        continue
      }

      for (const tunnel of tunnels) {
        const tunnelRemotePort = (tunnel as unknown as Record<string, unknown>).remotePort as number | undefined
        if (tunnelRemotePort && tunnelRemotePort === remotePort) {
          return {
            inUse: true,
            nodeId,
            tunnelName: tunnel.name
          }
        }
      }
    }

    return { inUse: false }
  }

  /** Clear tunnels for a node (called when node disconnects) */
  private clearNodeTunnels(nodeId: string): void {
    this.tunnelRegistry.delete(nodeId)
    this.log.debug('Cleared tunnels for node', { nodeId })
  }

  /** Update dispose method to clear tunnels */
  async dispose(): Promise<void> {
    // Clear all heartbeat timers
    for (const timer of this.heartbeatTimers.values()) {
      clearTimeout(timer)
    }
    this.heartbeatTimers.clear()

    // Clear tunnel registry
    this.tunnelRegistry.clear()

    this.log.info('NodeManager disposed')
  }
}

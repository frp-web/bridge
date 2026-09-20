/**
 * Node registry + tunnel registry（mesh 节点元数据管理）。
 *
 * 职责：
 *   - register/unregister/heartbeat 节点元数据
 *   - 节点级 tunnel 缓存（用于 remotePort 冲突检测）
 *   - 心跳超时标记 offline
 *
 * 注意：outbox 已迁移到 transport/outbox.ts（由 RpcClient 自管）。
 */

import type {
  NodeHeartbeatPayload,
  NodeInfo,
  NodeListQuery,
  NodeListResponse,
  NodeRegisterPayload,
  NodeSnapshotPayload,
  NodeStatistics,
  ProxyConfig
} from '@frp-bridge/types'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { nodeManagerLogger } from '@frp-bridge/shared'

export interface NodeManagerOptions {
  heartbeatTimeout?: number
}

export interface NodeStorage {
  save: (node: NodeInfo) => Promise<void> | void
  delete: (id: string) => Promise<void> | void
  load: (id: string) => Promise<NodeInfo | undefined> | NodeInfo | undefined
  list: () => Promise<NodeInfo[]> | NodeInfo[]
}

export type NodeEventType
  = | 'registered'
    | 'heartbeat'
    | 'unregistered'
    | 'status'
    | 'tunnel-synced'

export interface NodeEvent {
  type: NodeEventType
  timestamp: number
  payload: Record<string, unknown>
}

export class NodeManager extends EventEmitter {
  private nodes = new Map<string, NodeInfo>()
  private tunnels = new Map<string, ProxyConfig[]>()
  private heartbeatTimers = new Map<string, NodeJS.Timeout>()
  private heartbeatTimeout: number
  private nodeStorage?: NodeStorage
  private readonly log = nodeManagerLogger

  constructor(options: NodeManagerOptions = {}, storage?: NodeStorage) {
    super()
    this.heartbeatTimeout = options.heartbeatTimeout ?? 90000
    this.nodeStorage = storage
  }

  async load(): Promise<void> {
    if (this.nodeStorage) {
      try {
        const items = await this.nodeStorage.list()
        for (const node of items) {
          this.nodes.set(node.id, node)
          this.tunnels.set(node.id, node.tunnels ?? [])
          this.setupHeartbeatTimer(node.id)
        }
        this.log.info(`Loaded ${items.length} nodes from storage`)
      }
      catch (error) {
        this.log.error('Failed to load nodes from storage', { error })
      }
    }
  }

  async register(payload: NodeRegisterPayload): Promise<NodeInfo> {
    const now = Date.now()
    const nodeId = randomUUID()
    const info: NodeInfo = {
      id: nodeId,
      ip: payload.ip ?? '',
      port: payload.port ?? 0,
      protocol: payload.protocol ?? 'tcp',
      serverAddr: payload.serverAddr ?? '',
      serverPort: payload.serverPort ?? 0,
      hostname: payload.hostname,
      osType: payload.osType,
      osRelease: payload.osRelease,
      platform: payload.platform,
      cpuCores: payload.cpuCores,
      memTotal: payload.memTotal,
      frpVersion: payload.frpVersion,
      bridgeVersion: payload.bridgeVersion,
      status: 'online',
      connectedAt: now,
      lastHeartbeat: now,
      createdAt: now,
      updatedAt: now,
      tunnels: []
    }

    this.nodes.set(nodeId, info)
    this.tunnels.set(nodeId, [])
    this.setupHeartbeatTimer(nodeId)

    if (this.nodeStorage) {
      try {
        await this.nodeStorage.save(info)
      }
      catch (error) {
        this.log.error('Failed to save node', { nodeId, error })
      }
    }

    this.emitEvent('registered', { nodeId, nodeInfo: info })
    this.log.success('Node registered', { nodeId, hostname: payload.hostname })
    return info
  }

  async heartbeat(payload: NodeHeartbeatPayload): Promise<void> {
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

    this.setupHeartbeatTimer(payload.nodeId)

    if (this.nodeStorage) {
      try {
        await this.nodeStorage.save(node)
      }
      catch (error) {
        this.log.error('Failed to persist heartbeat', { nodeId: payload.nodeId, error })
      }
    }

    this.emitEvent('heartbeat', { nodeId: payload.nodeId })
    if (oldStatus !== payload.status) {
      this.emitEvent('status', { nodeId: payload.nodeId, oldStatus, newStatus: payload.status })
    }
  }

  async unregister(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId)
    if (!node) {
      return
    }

    this.nodes.delete(nodeId)
    this.tunnels.delete(nodeId)
    this.clearHeartbeatTimer(nodeId)

    if (this.nodeStorage) {
      try {
        await this.nodeStorage.delete(nodeId)
      }
      catch (error) {
        this.log.error('Failed to delete node', { nodeId, error })
      }
    }

    this.emitEvent('unregistered', { nodeId })
    this.log.info('Node unregistered', { nodeId })
  }

  get(id: string): NodeInfo | undefined {
    return this.nodes.get(id)
  }

  list(query: NodeListQuery = {}): NodeListResponse {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const status = query.status
    const search = query.search?.toLowerCase()

    let items = Array.from(this.nodes.values())
    if (status) {
      items = items.filter(n => n.status === status)
    }
    if (search) {
      items = items.filter(n =>
        n.hostname?.toLowerCase().includes(search)
        || n.ip.toLowerCase().includes(search)
        || n.id.toLowerCase().includes(search)
      )
    }

    const total = items.length
    const start = (page - 1) * pageSize
    return {
      items: items.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total
    }
  }

  online(): NodeInfo[] {
    return Array.from(this.nodes.values()).filter(n => n.status === 'online')
  }

  snapshot(): NodeInfo[] {
    return Array.from(this.nodes.values())
  }

  statistics(): NodeStatistics {
    const items = Array.from(this.nodes.values())
    return {
      total: items.length,
      online: items.filter(n => n.status === 'online').length,
      offline: items.filter(n => n.status === 'offline').length,
      connecting: items.filter(n => n.status === 'connecting').length,
      error: items.filter(n => n.status === 'error').length
    }
  }

  listTunnels(): { nodeId: string, tunnels: ProxyConfig[] }[] {
    return Array.from(this.tunnels.entries()).map(([nodeId, tunnels]) => ({ nodeId, tunnels }))
  }

  getTunnel(nodeId: string, name: string): ProxyConfig | undefined {
    return this.tunnels.get(nodeId)?.find(t => t.name === name)
  }

  tunnelsByName(name: string): { nodeId: string, tunnel: ProxyConfig }[] {
    const result: { nodeId: string, tunnel: ProxyConfig }[] = []
    for (const [nodeId, list] of this.tunnels.entries()) {
      const tunnel = list.find(t => t.name === name)
      if (tunnel) {
        result.push({ nodeId, tunnel })
      }
    }
    return result
  }

  isRemotePortInUse(remotePort: number, excludeNodeId?: string): { inUse: boolean, nodeId?: string, tunnelName?: string } {
    for (const [nodeId, list] of this.tunnels.entries()) {
      if (excludeNodeId && nodeId === excludeNodeId) {
        continue
      }
      for (const tunnel of list) {
        if ((tunnel as unknown as { remotePort?: number }).remotePort === remotePort) {
          return { inUse: true, nodeId, tunnelName: tunnel.name }
        }
      }
    }
    return { inUse: false }
  }

  applySnapshot(snapshot: NodeSnapshotPayload): void {
    const node = this.nodes.get(snapshot.nodeId)
    if (!node) {
      return
    }
    this.tunnels.set(snapshot.nodeId, snapshot.tunnels)
    node.tunnels = snapshot.tunnels
    node.updatedAt = snapshot.timestamp

    if (this.nodeStorage) {
      Promise.resolve(this.nodeStorage.save(node)).catch((error: unknown) => {
        this.log.error('Failed to persist node snapshot', { nodeId: snapshot.nodeId, error })
      })
    }

    this.emitEvent('tunnel-synced', { nodeId: snapshot.nodeId, tunnelCount: snapshot.tunnels.length })
  }

  private emitEvent(type: NodeEventType, payload: Record<string, unknown>): void {
    const event: NodeEvent = { type, timestamp: Date.now(), payload }
    this.emit('node:event', event)
    this.emit(type, event)
  }

  private setupHeartbeatTimer(nodeId: string): void {
    this.clearHeartbeatTimer(nodeId)
    const timer = setTimeout(() => this.handleHeartbeatTimeout(nodeId), this.heartbeatTimeout)
    this.heartbeatTimers.set(nodeId, timer)
  }

  private clearHeartbeatTimer(nodeId: string): void {
    const timer = this.heartbeatTimers.get(nodeId)
    if (timer) {
      clearTimeout(timer)
      this.heartbeatTimers.delete(nodeId)
    }
  }

  private async handleHeartbeatTimeout(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId)
    if (!node) {
      return
    }
    const oldStatus = node.status
    node.status = 'offline'
    node.updatedAt = Date.now()
    if (this.nodeStorage) {
      try {
        await this.nodeStorage.save(node)
      }
      catch (error) {
        this.log.error('Failed to persist offline node', { nodeId, error })
      }
    }
    this.emitEvent('status', { nodeId, oldStatus, newStatus: 'offline', reason: 'heartbeat_timeout' })
    this.log.warn('Node heartbeat timeout', { nodeId, hostname: node.hostname })
  }

  dispose(): void {
    for (const timer of this.heartbeatTimers.values()) {
      clearTimeout(timer)
    }
    this.heartbeatTimers.clear()
    this.tunnels.clear()
  }
}

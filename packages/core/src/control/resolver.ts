/**
 * NodeControlResolver — nodeId → FrpControlApi 映射。
 *
 * - resolve('self') / resolve(selfNodeId) → 本节点 api
 * - resolve(peerId) → 已注册 peer 的 ProxyApi；未注册返回 null
 * - list() → self + 所有 peer
 * - on('added' | 'removed') → peer 注册/下线事件
 */

import type { FrpControlApi } from '@frp-bridge/types'
import type { SendCommandFn } from './proxy-api'
import { EventEmitter } from 'node:events'
import { createLogger } from '@frp-bridge/shared'
import { ProxyApi } from './proxy-api'

const log = createLogger('ControlResolver')

export interface NodeControlResolverOptions {
  selfNodeId: string
  selfApi: FrpControlApi
  /** 来自 transport 层：发送 command 到指定 peer */
  sendCommand: SendCommandFn
}

export class NodeControlResolver extends EventEmitter {
  private readonly selfNodeId: string
  private readonly selfApi: FrpControlApi
  private readonly sendCommand: SendCommandFn

  /** peerId → ProxyApi */
  private readonly peers = new Map<string, ProxyApi>()

  constructor(options: NodeControlResolverOptions) {
    super()
    this.selfNodeId = options.selfNodeId
    this.selfApi = options.selfApi
    this.sendCommand = options.sendCommand
  }

  resolve(nodeId: 'self' | string): FrpControlApi | null {
    if (nodeId === 'self' || nodeId === this.selfNodeId) {
      return this.selfApi
    }
    return this.peers.get(nodeId) ?? null
  }

  list(): FrpControlApi[] {
    return [this.selfApi, ...this.peers.values()]
  }

  /** 由 transport 层调用：peer 上线 → 注册 ProxyApi */
  addPeer(nodeId: string, target: 'frps' | 'frpc' = 'frpc'): ProxyApi {
    const existing = this.peers.get(nodeId)
    if (existing)
      return existing

    const proxy = new ProxyApi({
      nodeId,
      role: 'peer',
      target,
      originatorId: this.selfNodeId,
      sendCommand: this.sendCommand
    })
    this.peers.set(nodeId, proxy)
    log.debug('peer proxy created', { nodeId, target })
    this.emit('added', nodeId)
    return proxy
  }

  /** 由 transport 层调用：peer 下线 → 移除 ProxyApi */
  removePeer(nodeId: string): void {
    const proxy = this.peers.get(nodeId)
    if (!proxy)
      return
    proxy.dispose()
    this.peers.delete(nodeId)
    this.emit('removed', nodeId)
  }

  /** 清空（dispose 时） */
  clear(): void {
    for (const proxy of this.peers.values()) {
      proxy.dispose()
    }
    this.peers.clear()
  }

  knownNodeIds(): string[] {
    return [...this.peers.keys()]
  }
}

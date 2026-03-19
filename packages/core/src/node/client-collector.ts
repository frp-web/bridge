/**
 * Client-side node information collector
 * Gathers system information and reports to server via heartbeat
 */

import type { NodeHeartbeatPayload, NodeRegisterPayload } from '@frp-bridge/types'
import { cpus, hostname, platform, release, totalmem } from 'node:os'
import { clientCollectorLogger } from '@frp-bridge/shared'
import { ValidationError } from '../errors'

export interface ClientCollectorOptions {
  /** Node ID (set by server after registration) */
  nodeId?: string
  /** Heartbeat interval in milliseconds (default: 30000) */
  heartbeatInterval?: number
}

/**
 * Collects node information on client side
 * Used in client mode to send system info and heartbeat to server
 */
export class ClientNodeCollector {
  private nodeId?: string
  private heartbeatInterval: number
  private readonly log = clientCollectorLogger
  private heartbeatTimer?: NodeJS.Timeout

  constructor(options: ClientCollectorOptions = {}) {
    this.nodeId = options.nodeId
    this.heartbeatInterval = options.heartbeatInterval ?? 30000
  }

  /** Set node ID after server registration */
  setNodeId(nodeId: string): void {
    this.nodeId = nodeId
  }

  /** Collect current node information */
  collectNodeInfo(): Partial<NodeRegisterPayload> {
    const cpuList = cpus()
    const totalMem = totalmem()

    return {
      hostname: hostname(),
      osType: platform(),
      osRelease: release(),
      cpuCores: cpuList.length,
      memTotal: totalMem,
      protocol: 'tcp', // Default protocol
      serverAddr: '', // Will be set by caller
      serverPort: 0 // Will be set by caller
    }
  }

  /** Collect heartbeat payload */
  collectHeartbeat(): Partial<NodeHeartbeatPayload> {
    if (!this.nodeId) {
      throw new ValidationError('Node ID not set. Call setNodeId() first or wait for registration.')
    }

    const cpuList = cpus()
    const totalMem = totalmem()

    return {
      nodeId: this.nodeId,
      status: 'online',
      lastHeartbeat: Date.now(),
      cpuCores: cpuList.length,
      memTotal: totalMem
    }
  }

  /**
   * Start periodic heartbeat collection
   * Callback will be called at each interval with heartbeat payload
   */
  startHeartbeat(
    callback: (payload: Partial<NodeHeartbeatPayload>) => void,
    interval?: number
  ): void {
    if (this.heartbeatTimer) {
      this.log.debug?.('Heartbeat already running')
      return
    }

    const heartbeatInterval = interval ?? this.heartbeatInterval

    // Send first heartbeat immediately
    try {
      const payload = this.collectHeartbeat()
      callback(payload)
    }
    catch (error) {
      this.log.error?.('Failed to collect initial heartbeat', error as Error)
    }

    // Schedule periodic heartbeats
    this.heartbeatTimer = setInterval(() => {
      try {
        const payload = this.collectHeartbeat()
        callback(payload)
      }
      catch (error) {
        this.log.error?.('Failed to collect heartbeat', error as Error)
      }
    }, heartbeatInterval)

    this.log.info?.(`Heartbeat started with interval ${heartbeatInterval}ms`)
  }

  /** Stop periodic heartbeat collection */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
      this.log.info?.('Heartbeat stopped')
    }
  }

  /** Check if heartbeat is running */
  isHeartbeatRunning(): boolean {
    return !!this.heartbeatTimer
  }
}

/**
 * FrpClientApi — control layer surface for an frpc process.
 *
 * Wraps a FrpProcessManager (running in client mode) and exposes:
 *   - process: lifecycle (start / stop / restart / status)
 *   - config:  raw text get / apply (optional restart)
 *   - tunnel:  add / update / remove / list / get / sync
 *
 * Emits ControlEvent on every successful tunnel/config mutation.
 */

import type {
  FrpConfigApi,
  FrpConfigSnapshot,
  FrpProcessApi,
  FrpTunnelApi,
  ProcessStatus,
  ProxyConfig,
  TunnelWithNode
} from '@frp-bridge/types'
import type { FrpProcessManager } from '../process'
import { createLogger } from '@frp-bridge/shared'
import { FrpControlApiBase } from './base'
import { hashConfigRaw } from './hash'

const log = createLogger('FrpClientApi')

export interface FrpClientApiOptions {
  nodeId: string
  originatorId: string
  process: FrpProcessManager
}

export class FrpClientApi extends FrpControlApiBase {
  readonly process: FrpProcessApi
  readonly config: FrpConfigApi
  readonly tunnel: FrpTunnelApi

  constructor(options: FrpClientApiOptions) {
    super({
      nodeId: options.nodeId,
      role: 'self',
      target: 'frpc',
      capabilities: {
        manageTunnels: true,
        manageConfig: true,
        manageProcess: true
      },
      originatorId: options.originatorId
    })

    const pm = options.process

    this.process = {
      start: async () => pm.start(),
      stop: async () => pm.stop(),
      restart: async () => {
        if (pm.isRunning()) {
          await pm.stop()
        }
        await pm.start()
      },
      status: async (): Promise<ProcessStatus> => {
        const s = pm.queryProcess()
        if (!s) {
          return { running: false }
        }
        return {
          running: s.running,
          pid: s.pid,
          uptime: s.uptime
        }
      }
    }

    this.config = {
      get: async (): Promise<FrpConfigSnapshot> => {
        const raw = pm.getConfigRaw() ?? ''
        return {
          raw,
          version: this._version,
          hash: hashConfigRaw(raw)
        }
      },
      apply: async (content: string, opts?: { restart?: boolean }): Promise<FrpConfigSnapshot> => {
        const shouldRestart = opts?.restart ?? false
        const wasRunning = pm.isRunning()

        pm.updateConfigRaw(content)

        if (shouldRestart || wasRunning) {
          if (wasRunning) {
            await pm.stop()
          }
          await pm.start()
        }

        this.emitEvent('config:applied', { restart: shouldRestart })
        return {
          raw: content,
          version: this._version,
          hash: hashConfigRaw(content)
        }
      }
    }

    this.tunnel = {
      list: async (): Promise<TunnelWithNode[]> => {
        const tunnels = await pm.listTunnels()
        return tunnels.map((t, idx) => this.withNodeMeta(t, idx, 'pending'))
      },
      get: async (name: string): Promise<TunnelWithNode | null> => {
        const tunnel = await pm.getTunnel(name)
        if (!tunnel) {
          return null
        }
        return this.withNodeMeta(tunnel, 0, 'pending')
      },
      add: async (tunnel: ProxyConfig): Promise<TunnelWithNode> => {
        await pm.addTunnel(tunnel)
        const result = this.withNodeMeta(tunnel, 0, 'pending')
        this.emitEvent('tunnel:added', result)
        log.success('tunnel added', { name: tunnel.name })
        return result
      },
      update: async (name: string, patch: Partial<ProxyConfig>): Promise<TunnelWithNode> => {
        await pm.updateTunnel(name, patch)
        const current = await pm.getTunnel(name)
        if (!current) {
          throw new Error(`Tunnel ${name} disappeared after update`)
        }
        const result = this.withNodeMeta(current, 0, 'pending')
        this.emitEvent('tunnel:updated', { name, patch, tunnel: result })
        log.success('tunnel updated', { name })
        return result
      },
      remove: async (name: string): Promise<void> => {
        await pm.removeTunnel(name)
        this.emitEvent('tunnel:removed', { name })
        log.success('tunnel removed', { name })
      },
      sync: async (): Promise<void> => {
        await pm.generateConfig(true)
        const tunnels = await pm.listTunnels()
        this.emitEvent('config:applied', { source: 'tunnel:sync', count: tunnels.length })
      }
    }
  }

  private withNodeMeta(tunnel: ProxyConfig, _idx: number, status: TunnelWithNode['status']): TunnelWithNode {
    return {
      ...tunnel,
      nodeId: this.nodeId,
      version: this._version,
      status
    }
  }
}

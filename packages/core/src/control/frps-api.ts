/**
 * FrpServerApi — control layer surface for an frps process.
 *
 * Wraps a FrpProcessManager (running in server mode) and exposes:
 *   - process: lifecycle (start / stop / restart / status)
 *   - config:  raw text get / apply (optional restart)
 *   - tunnel:  empty — frps doesn't manage local tunnels
 *
 * Note: tunnel management on frps is delegated to the remote frpc nodes
 * through the transport layer; this class only controls the frps process.
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
import { FrpControlApiBase } from './base'
import { hashConfigRaw } from './hash'

const EMPTY_TUNNEL: FrpTunnelApi = {
  list: async () => [],
  get: async () => null,
  add: async (_t: ProxyConfig) => {
    throw new Error('frps does not manage tunnels locally; target a peer frpc node')
  },
  update: async () => {
    throw new Error('frps does not manage tunnels locally; target a peer frpc node')
  },
  remove: async () => {
    throw new Error('frps does not manage tunnels locally; target a peer frpc node')
  },
  sync: async () => {
    /* no-op */
  }
}

export interface FrpServerApiOptions {
  nodeId: string
  originatorId: string
  process: FrpProcessManager
}

export class FrpServerApi extends FrpControlApiBase {
  readonly process: FrpProcessApi
  readonly config: FrpConfigApi
  readonly tunnel: FrpTunnelApi

  constructor(options: FrpServerApiOptions) {
    super({
      nodeId: options.nodeId,
      role: 'self',
      target: 'frps',
      capabilities: {
        manageTunnels: false,
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

    this.tunnel = EMPTY_TUNNEL
  }

  /** Helper used by NodeManager listener to push tunnel snapshot updates. */
  applyTunnelSnapshot(tunnels: TunnelWithNode[]): void {
    this.emitEvent('config:applied', { source: 'snapshot', count: tunnels.length })
  }
}

/**
 * ProxyApi — peer 节点的控制面代理。
 *
 * 每次调用 → 转成 CommandMessage → 通过 sendCommand 发到对端 → 等 ack。
 * 接口形态与 FrpControlApi 完全一致，上层无感知。
 */

import type {
  FrpConfigApi,
  FrpConfigSnapshot,
  FrpProcessApi,
  FrpTunnelApi,
  NodeCapabilities,
  NodeRole,
  ProcessStatus,
  ProxyConfig,
  TunnelWithNode
} from '@frp-bridge/types'
import { DEFAULT_CAPABILITIES } from '@frp-bridge/types'
import { FrpControlApiBase } from './base'

export interface SendCommandFn {
  (input: { target: string, action: string, payload: unknown[], timeoutMs?: number }): Promise<unknown>
}

export interface ProxyApiOptions {
  nodeId: string
  role: NodeRole
  target: 'frps' | 'frpc'
  originatorId: string
  sendCommand: SendCommandFn
  capabilities?: NodeCapabilities
}

export class ProxyApi extends FrpControlApiBase {
  readonly process: FrpProcessApi
  readonly config: FrpConfigApi
  readonly tunnel: FrpTunnelApi

  private readonly sendCommand: SendCommandFn
  private readonly targetPrefix: 'frps' | 'frpc'

  constructor(options: ProxyApiOptions) {
    super({
      nodeId: options.nodeId,
      role: options.role,
      target: options.target,
      capabilities: options.capabilities ?? DEFAULT_CAPABILITIES,
      originatorId: options.originatorId
    })
    this.sendCommand = options.sendCommand
    this.targetPrefix = options.target

    const action = (group: string, method: string): string => `${this.targetPrefix}.${group}.${method}`

    this.process = {
      start: async () => {
        await this.sendCommand({ target: this.nodeId, action: action('process', 'start'), payload: [] })
      },
      stop: async () => {
        await this.sendCommand({ target: this.nodeId, action: action('process', 'stop'), payload: [] })
      },
      restart: async () => {
        await this.sendCommand({ target: this.nodeId, action: action('process', 'restart'), payload: [] })
      },
      status: async (): Promise<ProcessStatus> => {
        const result = await this.sendCommand({ target: this.nodeId, action: action('process', 'status'), payload: [] })
        return (result ?? { running: false }) as ProcessStatus
      }
    }

    this.config = {
      get: async (): Promise<FrpConfigSnapshot> => {
        const result = await this.sendCommand({ target: this.nodeId, action: action('config', 'get'), payload: [] })
        return (result ?? { raw: '', version: 0, hash: '' }) as FrpConfigSnapshot
      },
      apply: async (content: string, opts?: { restart?: boolean }) => {
        const result = await this.sendCommand({
          target: this.nodeId,
          action: action('config', 'apply'),
          payload: [content, opts]
        })
        return (result ?? { raw: content, version: this._version, hash: '' }) as FrpConfigSnapshot
      }
    }

    this.tunnel = {
      list: async (): Promise<TunnelWithNode[]> => {
        const result = await this.sendCommand({ target: this.nodeId, action: action('tunnel', 'list'), payload: [] })
        return (Array.isArray(result) ? result : []) as TunnelWithNode[]
      },
      get: async (name: string): Promise<TunnelWithNode | null> => {
        const result = await this.sendCommand({ target: this.nodeId, action: action('tunnel', 'get'), payload: [name] })
        return (result ?? null) as TunnelWithNode | null
      },
      add: async (tunnel: ProxyConfig): Promise<TunnelWithNode> => {
        const result = await this.sendCommand({ target: this.nodeId, action: action('tunnel', 'add'), payload: [tunnel] })
        return result as TunnelWithNode
      },
      update: async (name: string, patch: Partial<ProxyConfig>): Promise<TunnelWithNode> => {
        const result = await this.sendCommand({
          target: this.nodeId,
          action: action('tunnel', 'update'),
          payload: [name, patch]
        })
        return result as TunnelWithNode
      },
      remove: async (name: string): Promise<void> => {
        await this.sendCommand({ target: this.nodeId, action: action('tunnel', 'remove'), payload: [name] })
      },
      sync: async (): Promise<void> => {
        await this.sendCommand({ target: this.nodeId, action: action('tunnel', 'sync'), payload: [] })
      }
    }
  }
}

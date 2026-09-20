/**
 * FrpBridge — 顶层 facade。
 *
 * 组装：
 *   Control Layer (FrpClientApi / FrpServerApi)
 *     ↕
 *   Transport Layer (RpcServer / RpcClient + ControlRouter + Outbox)
 *     ↕
 *   WebSocket (Nuxt /ws/rpc)
 *
 * 用法：
 *   const bridge = await FrpBridge.bootstrap({
 *     frpMode: 'server' | 'client',
 *     selfNodeId: 'xxx',
 *     meshToken: 'shared-secret',
 *     meshServerUrl: 'frp-web.example.com',   // 仅 client
 *     workDir: '/path/to/data',
 *   })
 */

import type { FrpControlApi } from '@frp-bridge/types'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { setGlobalLoggerOptions } from '@frp-bridge/shared'
import { join } from 'pathe'
import { FrpClientApi } from '../control/frpc-api'
import { FrpServerApi } from '../control/frps-api'
import { NodeControlResolver } from '../control/resolver'
import { FileNodeStorage } from '../node/file-node-storage'
import { NodeManager } from '../node/node-manager'
import { FrpProcessManager } from '../process'
import { NuxtWebSocketTransport } from '../transport/impl/nuxt-websocket-transport'
import { Outbox } from '../transport/outbox'
import { ExponentialBackoffStrategy } from '../transport/reconnect-strategy'
import { RpcClient } from '../transport/rpc-client'
import { RpcServer } from '../transport/rpc-server'
import { buildWsUrl } from '../transport/url-builder'
import { ensureDir } from '../utils'

export type FrpMode = 'server' | 'client'

export interface FrpBridgeOptions {
  frpMode: FrpMode
  /** 本节点 mesh id */
  selfNodeId?: string
  /** mesh 共享密钥 */
  meshToken: string
  /** 仅 client：要连的 S 地址（裸 IP / 域名 / URL） */
  meshServerUrl?: string
  /** 数据目录（默认 ~/.frp-web） */
  workDir?: string
  /** frp 二进制版本 */
  frpVersion?: string
  /** 自定义 frp 配置文件路径 */
  configPath?: string
}

export class FrpBridge {
  readonly frpMode: FrpMode
  readonly selfNodeId: string
  readonly selfApi: FrpControlApi
  readonly resolver: NodeControlResolver
  readonly nodeManager: NodeManager
  readonly processManager: FrpProcessManager

  /** server 模式存在 */
  readonly rpcServer?: RpcServer
  /** client 模式存在 */
  readonly rpcClient?: RpcClient

  private disposed = false

  private constructor(opts: {
    frpMode: FrpMode
    selfNodeId: string
    selfApi: FrpControlApi
    resolver: NodeControlResolver
    nodeManager: NodeManager
    processManager: FrpProcessManager
    rpcServer?: RpcServer
    rpcClient?: RpcClient
  }) {
    this.frpMode = opts.frpMode
    this.selfNodeId = opts.selfNodeId
    this.selfApi = opts.selfApi
    this.resolver = opts.resolver
    this.nodeManager = opts.nodeManager
    this.processManager = opts.processManager
    this.rpcServer = opts.rpcServer
    this.rpcClient = opts.rpcClient

    // selfApi 事件 → mesh 广播
    const broadcast = (evt: Parameters<FrpControlApi['emit']>[0]): void => {
      if (this.rpcServer) {
        this.rpcServer.broadcastEvent(evt)
      }
      else if (this.rpcClient) {
        void this.rpcClient.sendEvent(evt)
      }
    }
    this.selfApi.on('tunnel:added', broadcast)
    this.selfApi.on('tunnel:updated', broadcast)
    this.selfApi.on('tunnel:removed', broadcast)
    this.selfApi.on('config:applied', broadcast)
    this.selfApi.on('process:status', broadcast)
  }

  static bootstrap(options: FrpBridgeOptions): FrpBridge {
    const selfNodeId = options.selfNodeId ?? randomUUID()
    const workDir = options.workDir ?? join(homedir(), '.frp-web')
    const runtimeDir = join(workDir, 'runtime')
    const processDir = join(workDir, 'process')

    ensureDir(workDir)
    ensureDir(runtimeDir)
    ensureDir(processDir)

    setGlobalLoggerOptions({ workspaceRoot: workDir, enableFile: true })

    const processManager = new FrpProcessManager({
      mode: options.frpMode,
      version: options.frpVersion,
      workDir: processDir,
      configPath: options.configPath,
      configDir: join(workDir, 'config')
    })

    const nodeStorageDir = join(runtimeDir, 'nodes')
    ensureDir(nodeStorageDir)

    const nodeManager = new NodeManager(
      { heartbeatTimeout: 90_000 },
      new FileNodeStorage(nodeStorageDir)
    )

    const selfApi = options.frpMode === 'server'
      ? new FrpServerApi({
          process: processManager,
          nodeId: selfNodeId,
          originatorId: selfNodeId
        })
      : new FrpClientApi({
          process: processManager,
          nodeId: selfNodeId,
          originatorId: selfNodeId
        })

    if (options.frpMode === 'server') {
      const rpcServer = new RpcServer({
        selfNodeId,
        selfApi,
        validateToken: token => token === options.meshToken
      })

      const resolver = new NodeControlResolver({
        selfNodeId,
        selfApi,
        sendCommand: async () => {
          throw new Error('server-side resolver does not dispatch outbound commands; use peer ProxyApi via rpcServer.pushTo')
        }
      })

      rpcServer.on('connect', (identity) => {
        resolver.addPeer(identity.nodeId, 'frpc')
      })
      rpcServer.on('disconnect', (identity) => {
        resolver.removePeer(identity.nodeId)
      })

      return new FrpBridge({
        frpMode: 'server',
        selfNodeId,
        selfApi,
        resolver,
        nodeManager,
        processManager,
        rpcServer
      })
    }

    // client 模式
    if (!options.meshServerUrl) {
      throw new Error('meshServerUrl is required when frpMode=client')
    }

    const wsUrl = buildWsUrl(options.meshServerUrl)
    const transport = new NuxtWebSocketTransport({ url: wsUrl })
    const rpcClient = new RpcClient({
      selfNodeId,
      selfApi,
      token: options.meshToken,
      transport,
      reconnect: new ExponentialBackoffStrategy(1000, 2, 30_000),
      outbox: new Outbox()
    })

    const resolver = new NodeControlResolver({
      selfNodeId,
      selfApi,
      sendCommand: async ({ target, action, payload, timeoutMs }) => {
        return await rpcClient.sendCommand({ target, action, payload, timeoutMs })
      }
    })

    return new FrpBridge({
      frpMode: 'client',
      selfNodeId,
      selfApi,
      resolver,
      nodeManager,
      processManager,
      rpcClient
    })
  }

  /**
   * client: connect 到 S
   * server: 由 Nuxt defineWebSocketHandler 把新 peer 传给 rpcServer.accept()
   */
  async initialize(): Promise<void> {
    if (this.disposed) {
      throw new Error('bridge disposed')
    }
    if (this.rpcClient) {
      await this.rpcClient.connect()
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed)
      return
    this.disposed = true
    if (this.rpcClient) {
      await this.rpcClient.disconnect()
    }
    if (this.rpcServer) {
      await this.rpcServer.stop()
    }
    this.resolver.clear()
    this.selfApi.dispose()
  }

  get isDisposed(): boolean {
    return this.disposed
  }
}

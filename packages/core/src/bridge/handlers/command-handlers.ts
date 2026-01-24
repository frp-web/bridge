import type { NodeHeartbeatPayload, NodeRegisterPayload } from '@frp-bridge/types'
import type { NodeManager } from '../../node'
import type { FrpProcessManager } from '../../process'
import type { RpcServer } from '../../rpc'
import type { CommandHandler, CommandHandlerContext, CommandResult, RuntimeEvent } from '../../runtime'
import type { ConfigApplyPayload, ConfigApplyRawPayload, ProxyAddPayload, ProxyRemovePayload, ProxyUpdatePayload } from '../types'

/**
 * External dependencies needed by command handlers
 */
export interface CommandDependencies {
  process: FrpProcessManager
  nodeManager?: NodeManager
  rpcServer?: RpcServer
  mode: 'client' | 'server'
}

/**
 * Helper function to check if proxy type uses remotePort
 */
function typeUsesRemotePort(type: string): boolean {
  return ['tcp', 'udp', 'stcp', 'xtcp', 'sudp', 'tcpmux'].includes(type)
}

/**
 * Helper to run config mutations with optional restart
 */
export async function runConfigMutation(
  process: FrpProcessManager,
  mutate: () => Promise<void> | void,
  restart: boolean | undefined,
  ctx: CommandHandlerContext
): Promise<CommandResult> {
  await mutate()

  const shouldRestart = restart ?? true
  let events: RuntimeEvent[] | undefined

  if (shouldRestart) {
    if (process.isRunning()) {
      await process.stop()
    }
    await process.start()
    events = [
      {
        type: 'process:started',
        timestamp: Date.now()
      }
    ]
  }

  ctx.requestVersionBump()

  return {
    status: 'success',
    events
  }
}

/**
 * Create config apply command handler
 */
export function createConfigApplyCommand(deps: CommandDependencies): CommandHandler<ConfigApplyPayload> {
  return async (command, ctx) => {
    if (!command.payload?.config) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'config.apply requires payload.config'
        }
      }
    }

    return runConfigMutation(
      deps.process,
      async () => {
        deps.process.updateConfig(command.payload!.config)
      },
      command.payload.restart,
      ctx
    )
  }
}

/**
 * Create config apply raw command handler
 */
export function createConfigApplyRawCommand(deps: CommandDependencies): CommandHandler<ConfigApplyRawPayload> {
  return async (command, ctx) => {
    const content = command.payload?.content
    if (!content?.trim()) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'config.applyRaw requires payload.content'
        }
      }
    }

    try {
      const { parse: parseToml } = await import('../../toml')
      parseToml(content)
    }
    catch (error) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'config.applyRaw received invalid TOML content',
          details: error instanceof Error ? { message: error.message } : undefined
        }
      }
    }

    return runConfigMutation(
      deps.process,
      async () => {
        deps.process.updateConfigRaw(content)
      },
      command.payload?.restart,
      ctx
    )
  }
}

/**
 * Create process stop command handler
 */
export function createProcessStopCommand(deps: CommandDependencies): CommandHandler {
  return async () => {
    if (deps.process.isRunning()) {
      await deps.process.stop()
      return {
        status: 'success',
        events: [
          {
            type: 'process:stopped',
            timestamp: Date.now()
          }
        ]
      }
    }

    return {
      status: 'success'
    }
  }
}

/**
 * Create node register command handler
 */
export function createNodeRegisterCommand(deps: CommandDependencies): CommandHandler<NodeRegisterPayload> {
  return async (command) => {
    if (!deps.nodeManager) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'node.register is only available in server mode'
        }
      }
    }

    const payload = command.payload
    if (!payload || !payload.hostname || !payload.serverAddr || !payload.serverPort) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'node.register requires hostname, serverAddr, and serverPort'
        }
      }
    }

    try {
      const nodeInfo = await deps.nodeManager.registerNode(payload)
      return {
        status: 'success',
        result: nodeInfo
      }
    }
    catch (error) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: error instanceof Error ? error.message : 'Failed to register node'
        }
      }
    }
  }
}

/**
 * Create node heartbeat command handler
 */
export function createNodeHeartbeatCommand(deps: CommandDependencies): CommandHandler<NodeHeartbeatPayload> {
  return async (command) => {
    if (!deps.nodeManager) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'node.heartbeat is only available in server mode'
        }
      }
    }

    const payload = command.payload
    if (!payload || !payload.nodeId) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'node.heartbeat requires nodeId'
        }
      }
    }

    try {
      await deps.nodeManager.updateHeartbeat(payload)
      return {
        status: 'success'
      }
    }
    catch (error) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: error instanceof Error ? error.message : 'Failed to process heartbeat'
        }
      }
    }
  }
}

/**
 * Create node unregister command handler
 */
export function createNodeUnregisterCommand(deps: CommandDependencies): CommandHandler<{ nodeId: string }> {
  return async (command) => {
    if (!deps.nodeManager) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'node.unregister is only available in server mode'
        }
      }
    }

    const nodeId = command.payload?.nodeId
    if (!nodeId) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'node.unregister requires nodeId'
        }
      }
    }

    try {
      deps.nodeManager.unregisterNode(nodeId)
      return {
        status: 'success'
      }
    }
    catch (error) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: error instanceof Error ? error.message : 'Failed to unregister node'
        }
      }
    }
  }
}

/**
 * Create proxy add command handler
 */
export function createProxyAddCommand(deps: CommandDependencies): CommandHandler<ProxyAddPayload> {
  return async (command) => {
    const payload = command.payload
    if (!payload || !payload.proxy) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'proxy.add requires payload.proxy'
        }
      }
    }

    // Server mode: forward to node via RPC or validate globally
    if (deps.mode === 'server') {
      if (!payload.nodeId) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'proxy.add requires payload.nodeId in server mode'
          }
        }
      }

      // Check global port conflict before forwarding
      const proxyRemotePort = (payload.proxy as any).remotePort
      if (proxyRemotePort && typeUsesRemotePort(payload.proxy.type)) {
        const portCheck = deps.nodeManager?.isRemotePortInUse(proxyRemotePort, payload.nodeId)
        if (portCheck?.inUse) {
          return {
            status: 'failed',
            error: {
              code: 'PORT_CONFLICT',
              message: `Remote port ${proxyRemotePort} is already in use by tunnel "${portCheck.tunnelName}" on node ${portCheck.nodeId}`
            }
          }
        }
      }

      // Forward to node via RPC
      if (!deps.rpcServer) {
        return {
          status: 'failed',
          error: {
            code: 'RPC_NOT_AVAILABLE',
            message: 'RPC server not available'
          }
        }
      }

      try {
        const result = await deps.rpcServer.rpcCall(payload.nodeId, 'proxy.add', { proxy: payload.proxy })
        return {
          status: 'success',
          result
        }
      }
      catch (error) {
        return {
          status: 'failed',
          error: {
            code: 'RPC_ERROR',
            message: error instanceof Error ? error.message : 'Failed to add tunnel on node'
          }
        }
      }
    }

    // Client mode: add locally
    try {
      deps.process.addTunnel(payload.proxy)
      return {
        status: 'success',
        result: payload.proxy
      }
    }
    catch (error) {
      return {
        status: 'failed',
        error: {
          code: 'RUNTIME_ERROR',
          message: error instanceof Error ? error.message : 'Failed to add tunnel'
        }
      }
    }
  }
}

/**
 * Create proxy update command handler
 */
export function createProxyUpdateCommand(deps: CommandDependencies): CommandHandler<ProxyUpdatePayload> {
  return async (command) => {
    const payload = command.payload
    if (!payload || !payload.name) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'proxy.update requires payload.name'
        }
      }
    }

    // Server mode: forward to node via RPC
    if (deps.mode === 'server') {
      if (!payload.nodeId) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'proxy.update requires payload.nodeId in server mode'
          }
        }
      }

      // Check global port conflict if remotePort is being changed
      const newRemotePort = (payload.proxy as any)?.remotePort
      if (newRemotePort && typeUsesRemotePort((payload.proxy as any)?.type)) {
        const portCheck = deps.nodeManager?.isRemotePortInUse(newRemotePort, payload.nodeId)
        if (portCheck?.inUse) {
          return {
            status: 'failed',
            error: {
              code: 'PORT_CONFLICT',
              message: `Remote port ${newRemotePort} is already in use by tunnel "${portCheck.tunnelName}" on node ${portCheck.nodeId}`
            }
          }
        }
      }

      if (!deps.rpcServer) {
        return {
          status: 'failed',
          error: {
            code: 'RPC_NOT_AVAILABLE',
            message: 'RPC server not available'
          }
        }
      }

      try {
        const result = await deps.rpcServer.rpcCall(payload.nodeId, 'proxy.update', { name: payload.name, proxy: payload.proxy })
        return {
          status: 'success',
          result
        }
      }
      catch (error) {
        return {
          status: 'failed',
          error: {
            code: 'RPC_ERROR',
            message: error instanceof Error ? error.message : 'Failed to update tunnel on node'
          }
        }
      }
    }

    // Client mode: update locally
    try {
      deps.process.updateTunnel(payload.name, payload.proxy)
      return {
        status: 'success',
        result: { name: payload.name, ...payload.proxy }
      }
    }
    catch (error) {
      return {
        status: 'failed',
        error: {
          code: 'RUNTIME_ERROR',
          message: error instanceof Error ? error.message : 'Failed to update tunnel'
        }
      }
    }
  }
}

/**
 * Create proxy remove command handler
 */
export function createProxyRemoveCommand(deps: CommandDependencies): CommandHandler<ProxyRemovePayload> {
  return async (command) => {
    const payload = command.payload
    if (!payload || !payload.name) {
      return {
        status: 'failed',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'proxy.remove requires payload.name'
        }
      }
    }

    // Server mode: forward to node via RPC
    if (deps.mode === 'server') {
      if (!payload.nodeId) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'proxy.remove requires payload.nodeId in server mode'
          }
        }
      }

      if (!deps.rpcServer) {
        return {
          status: 'failed',
          error: {
            code: 'RPC_NOT_AVAILABLE',
            message: 'RPC server not available'
          }
        }
      }

      try {
        const result = await deps.rpcServer.rpcCall(payload.nodeId, 'proxy.remove', { name: payload.name })
        return {
          status: 'success',
          result
        }
      }
      catch (error) {
        return {
          status: 'failed',
          error: {
            code: 'RPC_ERROR',
            message: error instanceof Error ? error.message : 'Failed to remove tunnel on node'
          }
        }
      }
    }

    // Client mode: remove locally
    try {
      deps.process.removeTunnel(payload.name)
      return {
        status: 'success',
        result: { name: payload.name }
      }
    }
    catch (error) {
      return {
        status: 'failed',
        error: {
          code: 'RUNTIME_ERROR',
          message: error instanceof Error ? error.message : 'Failed to remove tunnel'
        }
      }
    }
  }
}

/**
 * Factory to create all command handlers
 */
export function createCommandHandlers(deps: CommandDependencies): Record<string, CommandHandler> {
  return {
    'config.apply': createConfigApplyCommand(deps) as CommandHandler,
    'config.applyRaw': createConfigApplyRawCommand(deps) as CommandHandler,
    'process.stop': createProcessStopCommand(deps) as CommandHandler,
    'node.register': createNodeRegisterCommand(deps) as CommandHandler,
    'node.heartbeat': createNodeHeartbeatCommand(deps) as CommandHandler,
    'node.unregister': createNodeUnregisterCommand(deps) as CommandHandler,
    'proxy.add': createProxyAddCommand(deps) as CommandHandler,
    'proxy.update': createProxyUpdateCommand(deps) as CommandHandler,
    'proxy.remove': createProxyRemoveCommand(deps) as CommandHandler
  }
}

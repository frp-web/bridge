import type { NodeHeartbeatPayload, NodeRegisterPayload, ProxyConfig } from '@frp-bridge/types'
import type { NodeDeletePayload, TunnelAddPayload, TunnelDeletePayload } from '../../rpc/message-types'
import type { CommandHandler, CommandHandlerContext, CommandResult, RuntimeEvent } from '../../runtime'
import type { ConfigApplyPayload, ConfigApplyRawPayload, ProxyAddPayload, ProxyRemovePayload, ProxyUpdatePayload } from '../types'
import type { CommandDependencies, Validator } from './decorators'
import { ConfigInvalidError, ValidationError } from '../../errors'
import { parse as parseToml } from '../../toml'
import { omitUndefined } from '../../utils'
import {
  compose,
  presets,
  withErrorHandling,
  withModeRouting,
  withNodeManager,
  withPortConflictCheck,
  withServerModeOnly,
  withValidation
} from './decorators'

/**
 * Helper to run config mutations with optional restart
 */
export async function runConfigMutation(
  process: CommandDependencies['process'],
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

// ============================================================================
// Validators
// ============================================================================

/**
 * Validate config apply payload
 */
const validateConfigApply: Validator<ConfigApplyPayload> = (payload) => {
  if (!payload?.config) {
    return { valid: false, error: 'config.apply requires payload.config' }
  }
  return { valid: true }
}

/**
 * Validate config apply raw payload
 */
const validateConfigApplyRaw: Validator<ConfigApplyRawPayload> = (payload) => {
  const content = payload?.content
  if (!content?.trim()) {
    return { valid: false, error: 'config.applyRaw requires payload.content' }
  }
  return { valid: true }
}

// ============================================================================
// Config Commands (using decorators)
// ============================================================================

/**
 * Core config apply handler
 */
function configApplyCore(deps: CommandDependencies): CommandHandler<ConfigApplyPayload> {
  return async (command, ctx) => {
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
 * Create config apply command handler with decorators
 */
export function createConfigApplyCommand(deps: CommandDependencies): CommandHandler<ConfigApplyPayload> {
  return compose<ConfigApplyPayload>(
    withErrorHandling,
    withValidation(validateConfigApply)
  )(configApplyCore(deps), deps)
}

/**
 * Core config apply raw handler
 */
function configApplyRawCore(deps: CommandDependencies): CommandHandler<ConfigApplyRawPayload> {
  return async (command, ctx) => {
    const content = command.payload!.content!

    // Validate TOML syntax
    try {
      parseToml(content)
    }
    catch (error) {
      throw new ConfigInvalidError(`config.applyRaw received invalid TOML content: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    return runConfigMutation(
      deps.process,
      async () => {
        deps.process.updateConfigRaw(content)
      },
      command.payload.restart,
      ctx
    )
  }
}

/**
 * Create config apply raw command handler with decorators
 */
export function createConfigApplyRawCommand(deps: CommandDependencies): CommandHandler<ConfigApplyRawPayload> {
  return compose<ConfigApplyRawPayload>(
    withErrorHandling,
    withValidation(validateConfigApplyRaw)
  )(configApplyRawCore(deps), deps)
}

/**
 * Create process stop command handler
 */
export function createProcessStopCommand(deps: CommandDependencies): CommandHandler {
  return withErrorHandling(async () => {
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
  }, deps)
}

// ============================================================================
// Node Validators
// ============================================================================

/**
 * Validate node heartbeat payload
 */
const validateNodeHeartbeat: Validator<NodeHeartbeatPayload> = (payload) => {
  if (!payload?.nodeId) {
    return { valid: false, error: 'node.heartbeat requires nodeId' }
  }
  return { valid: true }
}

/**
 * Validate node unregister payload
 */
const validateNodeUnregister: Validator<{ nodeId: string }> = (payload) => {
  if (!payload?.nodeId) {
    return { valid: false, error: 'node.unregister requires nodeId' }
  }
  return { valid: true }
}

// ============================================================================
// Node Commands (using decorators)
// ============================================================================

/**
 * Core node register handler
 */
function nodeRegisterCore(deps: CommandDependencies): CommandHandler<NodeRegisterPayload> {
  return async (command) => {
    const nodeInfo = await deps.nodeManager!.registerNode(command.payload!)
    return {
      status: 'success',
      result: nodeInfo
    }
  }
}

/**
 * Create node register command handler with decorators
 */
export function createNodeRegisterCommand(deps: CommandDependencies): CommandHandler<NodeRegisterPayload> {
  return presets.serverWithRequired<NodeRegisterPayload>('hostname', 'serverAddr', 'serverPort')(
    nodeRegisterCore(deps),
    deps
  )
}

/**
 * Core node heartbeat handler
 */
function nodeHeartbeatCore(deps: CommandDependencies): CommandHandler<NodeHeartbeatPayload> {
  return async (command) => {
    await deps.nodeManager!.updateHeartbeat(command.payload!)
    return {
      status: 'success'
    }
  }
}

/**
 * Create node heartbeat command handler with decorators
 */
export function createNodeHeartbeatCommand(deps: CommandDependencies): CommandHandler<NodeHeartbeatPayload> {
  return compose<NodeHeartbeatPayload>(
    withErrorHandling,
    withNodeManager,
    withServerModeOnly,
    withValidation(validateNodeHeartbeat)
  )(nodeHeartbeatCore(deps), deps)
}

/**
 * Core node unregister handler
 */
function nodeUnregisterCore(deps: CommandDependencies): CommandHandler<{ nodeId: string }> {
  return async (command) => {
    deps.nodeManager!.unregisterNode(command.payload!.nodeId)
    return {
      status: 'success'
    }
  }
}

/**
 * Create node unregister command handler with decorators
 */
export function createNodeUnregisterCommand(deps: CommandDependencies): CommandHandler<{ nodeId: string }> {
  return compose<{ nodeId: string }>(
    withErrorHandling,
    withNodeManager,
    withServerModeOnly,
    withValidation(validateNodeUnregister)
  )(nodeUnregisterCore(deps), deps)
}

// ============================================================================
// Proxy Validators
// ============================================================================

/**
 * Validate proxy add payload
 */
const validateProxyAdd: Validator<ProxyAddPayload> = (payload) => {
  if (!payload?.proxy) {
    return { valid: false, error: 'proxy.add requires payload.proxy' }
  }
  return { valid: true }
}

/**
 * Validate proxy update payload
 */
const validateProxyUpdate: Validator<ProxyUpdatePayload> = (payload) => {
  if (!payload?.name) {
    return { valid: false, error: 'proxy.update requires payload.name' }
  }
  return { valid: true }
}

/**
 * Validate proxy remove payload
 */
const validateProxyRemove: Validator<ProxyRemovePayload> = (payload) => {
  if (!payload?.name) {
    return { valid: false, error: 'proxy.remove requires payload.name' }
  }
  return { valid: true }
}

// ============================================================================
// Proxy Commands (using decorators)
// ============================================================================

/**
 * Local proxy add handler (client mode)
 */
async function proxyAddLocal(payload: ProxyAddPayload, deps: CommandDependencies): Promise<CommandResult> {
  deps.process.addTunnel(payload.proxy)
  return {
    status: 'success',
    result: payload.proxy
  }
}

/**
 * Create proxy add command handler with decorators and mode routing
 */
export function createProxyAddCommand(deps: CommandDependencies): CommandHandler<ProxyAddPayload> {
  return compose<ProxyAddPayload>(
    withErrorHandling,
    withValidation(validateProxyAdd),
    withPortConflictCheck
  )(
    withModeRouting(
      proxyAddLocal,
      'proxy.add',
      payload => ({ proxy: payload.proxy })
    )(async () => ({ status: 'success' }), deps),
    deps
  )
}

/**
 * Local proxy update handler (client mode)
 */
async function proxyUpdateLocal(payload: ProxyUpdatePayload, deps: CommandDependencies): Promise<CommandResult> {
  deps.process.updateTunnel(payload.name, payload.proxy)
  return {
    status: 'success',
    result: { name: payload.name, ...payload.proxy }
  }
}

/**
 * Create proxy update command handler with decorators and mode routing
 */
export function createProxyUpdateCommand(deps: CommandDependencies): CommandHandler<ProxyUpdatePayload> {
  return compose<ProxyUpdatePayload>(
    withErrorHandling,
    withValidation(validateProxyUpdate),
    withPortConflictCheck
  )(
    withModeRouting(
      proxyUpdateLocal,
      'proxy.update',
      payload => ({ name: payload.name, proxy: payload.proxy })
    )(async () => ({ status: 'success' }), deps),
    deps
  )
}

/**
 * Local proxy remove handler (client mode)
 */
async function proxyRemoveLocal(payload: ProxyRemovePayload, deps: CommandDependencies): Promise<CommandResult> {
  deps.process.removeTunnel(payload.name)
  return {
    status: 'success',
    result: { name: payload.name }
  }
}

/**
 * Create proxy remove command handler with decorators and mode routing
 */
export function createProxyRemoveCommand(deps: CommandDependencies): CommandHandler<ProxyRemovePayload> {
  return compose<ProxyRemovePayload>(
    withErrorHandling,
    withValidation(validateProxyRemove)
  )(
    withModeRouting(
      proxyRemoveLocal,
      'proxy.remove',
      payload => ({ name: payload.name })
    )(async () => ({ status: 'success' }), deps),
    deps
  )
}

// ============================================================================
// Preset Config Commands
// ============================================================================

/**
 * Preset config get handler
 */
export function createPresetConfigGetCommand(deps: CommandDependencies): CommandHandler {
  return withErrorHandling(async () => {
    const presetConfig = deps.process.getPresetConfig()
    return {
      status: 'success',
      result: presetConfig
    }
  }, deps)
}

/**
 * Preset config set handler
 */
export function createPresetConfigSetCommand(deps: CommandDependencies): CommandHandler<Record<string, any>> {
  return withErrorHandling(async (command, ctx) => {
    const config = command.payload?.config
    if (!config || typeof config !== 'object') {
      throw new ValidationError('preset.set requires payload.config')
    }

    const restart = command.payload?.restart ?? true

    deps.process.savePresetConfig(config)

    // Regenerate config file
    await deps.process.generateConfig(true)

    // Restart process if it's running and restart is not false
    if (restart && deps.process.isRunning()) {
      await deps.process.stop()
      await deps.process.start()
    }

    ctx.requestVersionBump()

    return {
      status: 'success',
      result: config
    }
  }, deps)
}

/**
 * Config generate handler
 */
export function createConfigGenerateCommand(deps: CommandDependencies): CommandHandler<{ force?: boolean }> {
  return withErrorHandling(async (command) => {
    const force = command.payload?.force ?? false
    await deps.process.generateConfig(force)

    return {
      status: 'success',
      result: {
        configPath: deps.process.getConfigPath()
      }
    }
  }, deps)
}

/**
 * Factory to create all command handlers
 */
export function createCommandHandlers(deps: CommandDependencies): Record<string, CommandHandler> {
  return {
    'config.apply': createConfigApplyCommand(deps) as CommandHandler,
    'config.applyRaw': createConfigApplyRawCommand(deps) as CommandHandler,
    'config.generate': createConfigGenerateCommand(deps) as CommandHandler,
    'preset.get': createPresetConfigGetCommand(deps) as CommandHandler,
    'preset.set': createPresetConfigSetCommand(deps) as CommandHandler,
    'process.stop': createProcessStopCommand(deps) as CommandHandler,
    'node.register': createNodeRegisterCommand(deps) as CommandHandler,
    'node.heartbeat': createNodeHeartbeatCommand(deps) as CommandHandler,
    'node.unregister': createNodeUnregisterCommand(deps) as CommandHandler,
    'node.delete': createNodeDeleteCommand(deps) as CommandHandler,
    'proxy.add': createProxyAddCommand(deps) as CommandHandler,
    'proxy.update': createProxyUpdateCommand(deps) as CommandHandler,
    'proxy.remove': createProxyRemoveCommand(deps) as CommandHandler,
    // Tunnel commands (aliases for proxy commands, matching document spec)
    'tunnel.add': createTunnelAddCommand(deps) as CommandHandler,
    'tunnel.delete': createTunnelDeleteCommand(deps) as CommandHandler
  }
}

// ============================================================================
// Tunnel Commands (matching document spec)
// ============================================================================

/**
 * Validate tunnel add payload
 */
const validateTunnelAdd: Validator<TunnelAddPayload> = (payload) => {
  if (!payload) {
    return { valid: false, error: 'tunnel.add requires payload' }
  }
  if (!payload.name || typeof payload.name !== 'string') {
    return { valid: false, error: 'tunnel.add requires payload.name' }
  }
  if (!payload.type || typeof payload.type !== 'string') {
    return { valid: false, error: 'tunnel.add requires payload.type' }
  }
  if (typeof payload.localPort !== 'number') {
    return { valid: false, error: 'tunnel.add requires payload.localPort to be a number' }
  }
  return { valid: true }
}

/**
 * Validate tunnel delete payload
 */
const validateTunnelDelete: Validator<TunnelDeletePayload> = (payload) => {
  if (!payload?.name) {
    return { valid: false, error: 'tunnel.delete requires payload.name' }
  }
  return { valid: true }
}

/**
 * Validate node delete payload
 */
const validateNodeDelete: Validator<NodeDeletePayload> = (payload) => {
  if (!payload?.name) {
    return { valid: false, error: 'node.delete requires payload.name' }
  }
  return { valid: true }
}

/**
 * Local tunnel add handler (client mode)
 * Compatible with document spec: { name, type, localPort, remotePort?, ... }
 */
async function tunnelAddLocal(payload: TunnelAddPayload, deps: CommandDependencies): Promise<CommandResult> {
  // Convert TunnelAddPayload to ProxyConfig format
  const proxyConfig: ProxyConfig = omitUndefined({
    name: payload.name,
    type: payload.type as ProxyConfig['type'],
    localIP: '127.0.0.1',
    localPort: payload.localPort,
    remotePort: payload.remotePort,
    customDomains: payload.customDomains,
    subdomain: payload.subdomain
  })

  deps.process.addTunnel(proxyConfig)
  return {
    status: 'success',
    result: { ...proxyConfig, success: true }
  }
}

/**
 * Create tunnel add command handler (matching document spec)
 * This is an alias for proxy.add with different payload format
 */
export function createTunnelAddCommand(deps: CommandDependencies): CommandHandler<TunnelAddPayload> {
  return compose<TunnelAddPayload>(
    withErrorHandling,
    withValidation(validateTunnelAdd),
    withPortConflictCheck
  )(
    withModeRouting(
      tunnelAddLocal,
      'tunnel.add',
      payload => ({ proxy: payload as any })
    )(async () => ({ status: 'success' }), deps),
    deps
  )
}

/**
 * Local tunnel delete handler (client mode)
 */
async function tunnelDeleteLocal(payload: TunnelDeletePayload, deps: CommandDependencies): Promise<CommandResult> {
  deps.process.removeTunnel(payload.name)
  return {
    status: 'success',
    result: { name: payload.name, success: true }
  }
}

/**
 * Create tunnel delete command handler (matching document spec)
 * This is an alias for proxy.remove
 */
export function createTunnelDeleteCommand(deps: CommandDependencies): CommandHandler<TunnelDeletePayload> {
  return compose<TunnelDeletePayload>(
    withErrorHandling,
    withValidation(validateTunnelDelete)
  )(
    withModeRouting(
      tunnelDeleteLocal,
      'tunnel.delete',
      payload => ({ name: payload.name })
    )(async () => ({ status: 'success' }), deps),
    deps
  )
}

/**
 * Node delete handler (server mode only)
 * Removes a node from the node manager
 */
function nodeDeleteCore(deps: CommandDependencies): CommandHandler<NodeDeletePayload> {
  return async (command) => {
    const nodeName = command.payload!.name
    deps.nodeManager!.unregisterNode(nodeName)
    return {
      status: 'success',
      result: { deletedNode: nodeName, success: true }
    }
  }
}

/**
 * Create node delete command handler (matching document spec)
 */
export function createNodeDeleteCommand(deps: CommandDependencies): CommandHandler<NodeDeletePayload> {
  return compose<NodeDeletePayload>(
    withErrorHandling,
    withNodeManager,
    withServerModeOnly,
    withValidation(validateNodeDelete)
  )(nodeDeleteCore(deps), deps)
}

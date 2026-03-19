/**
 * Pre-configured loggers for different components
 */

import { createLogger } from './logger'

export { createLogger, getDefaultWorkspaceRoot, getGlobalLoggerOptions, resolveLogDir, setGlobalLoggerOptions } from './logger'
export type { LogData, Logger, LoggerOptions, LogLevel } from './logger'

// Core loggers
export const coreLogger = createLogger('Core')
export const nodeManagerLogger = createLogger('NodeMgr')
export const rpcClientLogger = createLogger('RpcClient')
export const rpcServerLogger = createLogger('RpcServer')
export const processControllerLogger = createLogger('Process')
export const nodeControllerLogger = createLogger('Node')
export const tunnelManagerLogger = createLogger('Tunnel')

// Runtime loggers
export const runtimeLogger = createLogger('Runtime')
export const processLogger = createLogger('ProcessManager')

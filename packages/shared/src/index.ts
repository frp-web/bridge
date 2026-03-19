import ora from 'ora'

/** Execute function with loading spinner */
export async function loadingFunction<T>(message: string, fn: () => Promise<T>): Promise<T> {
  const spinner = ora(message).start()

  return fn().finally(() => {
    spinner.stop()
  })
}

export {
  binaryManagerLogger,
  clientCollectorLogger,
  configMergerLogger,
  configurationStoreLogger,
  coreLogger,
  nodeControllerLogger,
  nodeManagerLogger,
  presetConfigLogger,
  processControllerLogger,
  processLogger,
  rpcClientLogger,
  rpcMiddlewareLogger,
  rpcServerLogger,
  runtimeLogger,
  tunnelManagerLogger
} from '../logger'
// Logger exports
export { createLogger, getDefaultWorkspaceRoot, getGlobalLoggerOptions, resolveLogDir, setGlobalLoggerOptions } from '../logger/logger'
export type { LogData, Logger, LoggerOptions, LogLevel } from '../logger/logger'

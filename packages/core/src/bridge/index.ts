import type { ClientConfig, ServerConfig } from '@frp-bridge/types'
import type { FrpProcessManagerOptions } from '../process'
import type { CommandHandler, CommandHandlerContext, CommandResult, QueryHandler, QueryResult, RuntimeCommand, RuntimeContext, RuntimeEvent, RuntimeLogger, RuntimeMode, RuntimeQuery, RuntimeState, SnapshotStorage } from '../runtime'
import { homedir } from 'node:os'
import process from 'node:process'
import { consola } from 'consola'
import { join } from 'pathe'
import { FrpProcessManager } from '../process'
import { FrpRuntime } from '../runtime'
import { FileSnapshotStorage } from '../runtime/file-snapshot-storage'
import { ensureDir, parseToml } from '../utils'
import { DEFAULT_COMMAND_APPLY, DEFAULT_COMMAND_APPLY_RAW, DEFAULT_COMMAND_STOP, DEFAULT_QUERY_SNAPSHOT, DEFAULT_QUERY_STATUS } from './commands'

interface ConfigApplyPayload {
  config: Partial<ClientConfig | ServerConfig>
  restart?: boolean
}

interface ConfigApplyRawPayload {
  content: string
  restart?: boolean
}

interface FrpBridgeRuntimeOptions {
  id?: string
  mode?: RuntimeMode
  logger?: RuntimeLogger
  clock?: () => number
  platform?: string
  workDir?: string
}

interface FrpBridgeProcessOptions extends Partial<Omit<FrpProcessManagerOptions, 'mode'>> {
  mode?: 'client' | 'server'
  workDir?: string
}

export interface FrpBridgeOptions {
  mode: 'client' | 'server'
  workDir?: string
  runtime?: FrpBridgeRuntimeOptions
  process?: FrpBridgeProcessOptions
  storage?: SnapshotStorage
  commands?: Record<string, CommandHandler>
  queries?: Record<string, QueryHandler>
  eventSink?: (event: RuntimeEvent) => void
}

export class FrpBridge {
  private readonly runtime: FrpRuntime
  private readonly process: FrpProcessManager
  private readonly eventSink?: (event: RuntimeEvent) => void

  constructor(private readonly options: FrpBridgeOptions) {
    const rootWorkDir = options.workDir ?? join(homedir(), '.frp-bridge')
    const runtimeDir = options.runtime?.workDir ?? join(rootWorkDir, 'runtime')
    const processDir = options.process?.workDir ?? join(rootWorkDir, 'process')

    ensureDir(rootWorkDir)
    ensureDir(runtimeDir)
    ensureDir(processDir)

    const runtimeLogger = options.runtime?.logger ?? consola.withTag('FrpRuntime')
    const processLogger = options.process?.logger ?? consola.withTag('FrpProcessManager')

    this.process = new FrpProcessManager({
      mode: options.process?.mode ?? options.mode,
      version: options.process?.version,
      workDir: processDir,
      logger: processLogger
    })

    const storage = options.storage ?? new FileSnapshotStorage(join(runtimeDir, 'snapshots'))
    const runtimeContext: RuntimeContext = {
      id: options.runtime?.id ?? 'default',
      mode: options.runtime?.mode ?? options.mode,
      workDir: runtimeDir,
      platform: options.runtime?.platform ?? process.platform,
      clock: options.runtime?.clock,
      logger: runtimeLogger
    }

    const commands = {
      ...this.createDefaultCommands(),
      ...(options.commands ?? {})
    }

    const queries = {
      ...this.createDefaultQueries(),
      ...(options.queries ?? {})
    }

    this.runtime = new FrpRuntime(runtimeContext, {
      storage,
      commands,
      queries
    })

    this.eventSink = options.eventSink
  }

  execute<TPayload, TResult = unknown>(command: RuntimeCommand<TPayload>): Promise<CommandResult<TResult>> {
    return this.runtime.execute<TPayload, TResult>(command).finally(() => {
      this.forwardEvents()
    })
  }

  query<TPayload, TResult = unknown>(query: RuntimeQuery<TPayload>): Promise<QueryResult<TResult>> {
    return this.runtime.query<TPayload, TResult>(query).finally(() => {
      this.forwardEvents()
    })
  }

  snapshot(): RuntimeState {
    return this.runtime.snapshot()
  }

  drainEvents(): RuntimeEvent[] {
    return this.runtime.drainEvents()
  }

  getProcessManager(): FrpProcessManager {
    return this.process
  }

  getRuntime(): FrpRuntime {
    return this.runtime
  }

  private createDefaultCommands(): Record<string, CommandHandler<any, any>> {
    const apply: CommandHandler<ConfigApplyPayload> = async (command, ctx) => {
      if (!command.payload?.config) {
        return {
          status: 'failed',
          error: {
            code: 'VALIDATION_ERROR',
            message: 'config.apply requires payload.config'
          }
        }
      }

      return this.runConfigMutation(async () => {
        this.process.updateConfig(command.payload!.config)
      }, command.payload.restart, ctx)
    }

    const applyRaw: CommandHandler<ConfigApplyRawPayload> = async (command, ctx) => {
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

      return this.runConfigMutation(async () => {
        this.process.writeConfigFile(content)
      }, command.payload?.restart, ctx)
    }

    const stop: CommandHandler = async () => {
      if (this.process.isRunning()) {
        await this.process.stop()
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

    return {
      [DEFAULT_COMMAND_APPLY]: apply as CommandHandler,
      [DEFAULT_COMMAND_APPLY_RAW]: applyRaw as CommandHandler,
      [DEFAULT_COMMAND_STOP]: stop
    }
  }

  private createDefaultQueries(): Record<string, QueryHandler> {
    const status: QueryHandler = async () => {
      const runtimeState = this.runtime.snapshot()
      return {
        result: {
          running: this.process.isRunning(),
          config: this.process.getConfig()
        },
        version: runtimeState.version
      }
    }

    const snapshot: QueryHandler = async () => {
      const runtimeState = this.runtime.snapshot()
      return {
        result: runtimeState,
        version: runtimeState.version
      }
    }

    return {
      [DEFAULT_QUERY_STATUS]: status,
      [DEFAULT_QUERY_SNAPSHOT]: snapshot
    }
  }

  private forwardEvents(): void {
    if (!this.eventSink) {
      return
    }

    const events = this.runtime.drainEvents()
    events.forEach(event => this.eventSink?.(event))
  }

  private async runConfigMutation(
    mutate: () => Promise<void> | void,
    restart: boolean | undefined,
    ctx: CommandHandlerContext
  ): Promise<CommandResult> {
    await mutate()

    const shouldRestart = restart ?? true
    let events: RuntimeEvent[] | undefined

    if (shouldRestart) {
      if (this.process.isRunning()) {
        await this.process.stop()
      }
      await this.process.start()
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
}

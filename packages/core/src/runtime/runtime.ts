import type {
  CommandHandler,
  CommandHandlerContext,
  CommandResult,
  ConfigSnapshot,
  QueryHandler,
  QueryResult,
  RuntimeAdapters,
  RuntimeCommand,
  RuntimeContext,
  RuntimeError,
  RuntimeErrorCode,
  RuntimeEvent,
  RuntimeQuery,
  RuntimeState,
  SnapshotStorage
} from './contracts'

const ERROR_UNKNOWN_COMMAND = 'Unknown command'
const ERROR_UNKNOWN_QUERY = 'Unknown query'

export class FrpRuntime {
  private readonly storage?: SnapshotStorage

  private readonly commandHandlers = new Map<string, CommandHandler>()

  private readonly queryHandlers = new Map<string, QueryHandler>()

  private eventBuffer: RuntimeEvent[] = []

  private commandQueue: Promise<void> = Promise.resolve()

  private state: RuntimeState = {
    status: 'idle',
    version: 0
  }

  constructor(
    private readonly context: RuntimeContext,
    adapters: RuntimeAdapters = {}
  ) {
    this.storage = adapters.storage
    Object.entries(adapters.commands ?? {}).forEach(([name, handler]) => {
      this.commandHandlers.set(name, handler)
    })
    Object.entries(adapters.queries ?? {}).forEach(([name, handler]) => {
      this.queryHandlers.set(name, handler)
    })
  }

  registerCommand(name: string, handler: CommandHandler): void {
    this.commandHandlers.set(name, handler)
  }

  registerQuery(name: string, handler: QueryHandler): void {
    this.queryHandlers.set(name, handler)
  }

  execute<TPayload, TResult = unknown>(command: RuntimeCommand<TPayload>): Promise<CommandResult<TResult>> {
    const task = this.commandQueue.then(() => this.runCommand<TPayload, TResult>(command))
    this.commandQueue = task.then(
      () => undefined,
      () => undefined
    )
    return task
  }

  async query<TPayload, TResult = unknown>(query: RuntimeQuery<TPayload>): Promise<QueryResult<TResult>> {
    const handler = this.queryHandlers.get(query.name) as QueryHandler<TPayload, TResult> | undefined
    if (!handler) {
      throw this.buildError('VALIDATION_ERROR', `${ERROR_UNKNOWN_QUERY}: ${query.name}`)
    }
    return handler(query, this.context) as Promise<QueryResult<TResult>>
  }

  snapshot(): RuntimeState {
    return { ...this.state }
  }

  drainEvents(): RuntimeEvent[] {
    const events = this.eventBuffer
    this.eventBuffer = []
    return events
  }

  private async runCommand<TPayload, TResult>(command: RuntimeCommand<TPayload>): Promise<CommandResult<TResult>> {
    const handler = this.commandHandlers.get(command.name) as
      | CommandHandler<TPayload, TResult>
      | undefined
    if (!handler) {
      return {
        status: 'failed',
        error: this.buildError('VALIDATION_ERROR', `${ERROR_UNKNOWN_COMMAND}: ${command.name}`)
      } as CommandResult<TResult>
    }

    const contextSnapshot: RuntimeState = { ...this.state }
    const versionRef = { bumped: false }

    const handlerContext: CommandHandlerContext = {
      context: this.context,
      state: contextSnapshot,
      emit: events => this.pushEvents(events),
      requestVersionBump: () => this.bumpVersion(command.metadata?.author, versionRef)
    }

    this.state.status = 'running'

    try {
      const result = await handler(command, handlerContext)
      if (result.events) {
        this.pushEvents(result.events)
      }
      if (result.snapshot) {
        await this.persistSnapshot(result.snapshot, command.metadata?.author)
      }
      if (result.error) {
        this.state.lastError = result.error
        this.state.status = 'error'
      }
      else if (result.status === 'success') {
        this.state.lastError = undefined
        this.state.status = 'running'
      }
      return {
        ...result,
        version: result.version ?? this.state.version
      } satisfies CommandResult<TResult>
    }
    catch (error) {
      const runtimeError = this.normalizeError(error)
      this.state.lastError = runtimeError
      this.state.status = 'error'
      return {
        status: 'failed',
        error: runtimeError,
        version: this.state.version
      } as CommandResult<TResult>
    }
  }

  private pushEvents(events: RuntimeEvent[]): void {
    const timestamp = this.now()
    events.forEach((event) => {
      this.eventBuffer.push({
        ...event,
        timestamp: event.timestamp ?? timestamp,
        version: event.version ?? this.state.version
      })
    })
  }

  private bumpVersion(author: string | undefined, ref: { bumped: boolean }): number {
    if (ref.bumped) {
      return this.state.version
    }
    ref.bumped = true
    this.state.version += 1
    this.state.lastAppliedAt = this.now()
    if (author) {
      this.pushEvents([
        {
          type: 'config:version-bumped',
          timestamp: this.now(),
          version: this.state.version,
          payload: { author }
        }
      ])
    }
    return this.state.version
  }

  private async persistSnapshot(snapshot: ConfigSnapshot, author?: string): Promise<void> {
    if (!this.storage) {
      return
    }
    if (!snapshot) {
      return
    }
    await this.storage.save({
      ...snapshot,
      version: snapshot.version ?? this.state.version,
      appliedAt: snapshot.appliedAt ?? this.now(),
      author: snapshot.author ?? author
    })
  }

  private normalizeError(error: unknown): RuntimeError {
    if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
      return error as RuntimeError
    }
    return {
      code: 'SYSTEM_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error'
    }
  }

  private buildError(code: RuntimeErrorCode, message: string, details?: Record<string, unknown>): RuntimeError {
    return { code, message, details }
  }

  private now(): number {
    return this.context.clock ? this.context.clock() : Date.now()
  }
}

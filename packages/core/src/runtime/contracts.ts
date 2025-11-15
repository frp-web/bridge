export type Awaitable<T> = T | Promise<T>

export type RuntimeMode = 'client' | 'server'

export type RuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error'

export interface RuntimeContext {
  id: string
  mode: RuntimeMode
  workDir: string
  platform: string
  clock?: () => number
  logger?: RuntimeLogger
}

export interface RuntimeLogger {
  debug: (message: string, context?: Record<string, unknown>) => void
  info: (message: string, context?: Record<string, unknown>) => void
  warn: (message: string, context?: Record<string, unknown>) => void
  error: (message: string, context?: Record<string, unknown>) => void
}

export interface RuntimeState {
  status: RuntimeStatus
  version: number
  lastAppliedAt?: number
  lastError?: RuntimeError
}

export interface CommandMetadata {
  requestId?: string
  correlationId?: string
  author?: string
  issuedAt?: number
}

export interface RuntimeCommand<TPayload = unknown> {
  name: string
  payload: TPayload
  metadata?: CommandMetadata
}

export interface CommandResult<TResult = unknown> {
  status: CommandStatus
  version?: number
  events?: RuntimeEvent[]
  result?: TResult
  error?: RuntimeError
  snapshot?: ConfigSnapshot
}

export type CommandStatus = 'success' | 'failed' | 'pending'

export interface RuntimeQuery<TPayload = unknown> {
  name: string
  payload?: TPayload
}

export interface QueryResult<TResult = unknown> {
  result: TResult
  version: number
}

export interface RuntimeEvent<TPayload = unknown> {
  type: string
  timestamp: number
  version?: number
  payload?: TPayload
}

export interface RuntimeError {
  code: RuntimeErrorCode
  message: string
  details?: Record<string, unknown>
}

export type RuntimeErrorCode = 'VALIDATION_ERROR' | 'RUNTIME_ERROR' | 'SYSTEM_ERROR'

export interface ConfigSnapshot {
  version: number
  checksum: string
  appliedAt: number
  author?: string
  summary?: string
}

export interface SnapshotStorage {
  save: (snapshot: ConfigSnapshot) => Awaitable<void>
  load: (version: number) => Awaitable<ConfigSnapshot | undefined>
  list: () => Awaitable<ConfigSnapshot[]>
}

export interface CommandHandlerContext {
  context: RuntimeContext
  state: RuntimeState
  emit: (events: RuntimeEvent[]) => void
  requestVersionBump: () => number
}

export type CommandHandler<TPayload = unknown, TResult = unknown> = (
  command: RuntimeCommand<TPayload>,
  ctx: CommandHandlerContext
) => Awaitable<CommandResult<TResult>>

export type QueryHandler<TPayload = unknown, TResult = unknown> = (
  query: RuntimeQuery<TPayload>,
  ctx: RuntimeContext
) => Awaitable<QueryResult<TResult>>

export interface RuntimeAdapters {
  storage?: SnapshotStorage
  commands?: Record<string, CommandHandler>
  queries?: Record<string, QueryHandler>
}

export type LoggingLogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error'

export interface LoggerOptions {
  level?: LoggingLogLevel
  file?: string
  timestamp?: boolean
}

export interface LogData {
  [key: string]: unknown
}

export interface Logger {
  debug: (message: string, data?: LogData) => void
  info: (message: string, data?: LogData) => void
  success: (message: string, data?: LogData) => void
  warn: (message: string, data?: LogData) => void
  error: (message: string, error?: Error | LogData) => void
  setLevel: (level: LoggingLogLevel) => void
}

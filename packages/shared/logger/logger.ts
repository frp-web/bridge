/**
 * Logging utility for FRP Bridge
 * Supports both console output and file logging with daily rotation
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error'

export interface LogData {
  [key: string]: unknown
}

export interface LoggerOptions {
  level?: LogLevel
  dir?: string // Log directory, default workspace/.frp-web/logs
  workspaceRoot?: string // Workspace root dir, default homedir()
  enableConsole?: boolean // Enable console output, default true
  enableFile?: boolean // Enable file output, default true
}

export interface Logger {
  debug: (message: string, data?: LogData) => void
  info: (message: string, data?: LogData) => void
  success: (message: string, data?: LogData) => void
  warn: (message: string, data?: LogData) => void
  error: (message: string, error?: Error | LogData) => void
  setLevel: (level: LogLevel) => void
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  success: 1,
  warn: 2,
  error: 3
}

const COLORS = {
  reset: '\x1B[0m',
  dim: '\x1B[2m',
  debug: '\x1B[36m',
  info: '\x1B[34m',
  success: '\x1B[32m',
  warn: '\x1B[33m',
  error: '\x1B[31m'
} as const

function formatTime(date: Date): string {
  const yyyy = date.getFullYear()
  const MM = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const HH = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`
}

function formatDateForFile(date: Date): string {
  const yyyy = date.getFullYear()
  const MM = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${MM}-${dd}`
}

function padLevel(level: string): string {
  return level.padEnd(7)
}

/**
 * Get default workspace root directory
 * Uses user's home directory as the base
 */
export function getDefaultWorkspaceRoot(): string {
  return homedir()
}

/**
 * Resolve log directory to absolute path
 * - If dir is absolute, use it as-is
 * - If dir is relative, join with workspaceRoot
 * - Default is workspaceRoot/.frp-web/logs
 */
export function resolveLogDir(dir: string, workspaceRoot: string): string {
  if (dir.startsWith('/') || /^[a-z]:/i.test(dir)) {
    // Absolute path
    return dir
  }
  // Relative path, join with workspace root
  return join(workspaceRoot, dir)
}

/**
 * File writer with daily rotation support
 */
class LogFileWriter {
  private currentDate: string
  private logFilePath: string
  private logDir: string

  constructor(logDir: string) {
    this.logDir = logDir
    this.currentDate = formatDateForFile(new Date())
    this.ensureLogDir()
    this.logFilePath = this.getLogFilePath()
  }

  private ensureLogDir(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true })
    }
  }

  private getLogFilePath(): string {
    return join(this.logDir, `frp-bridge-${this.currentDate}.log`)
  }

  write(message: string): void {
    const today = formatDateForFile(new Date())

    // Check if date has changed, rotate log file if needed
    if (today !== this.currentDate) {
      this.currentDate = today
      this.logFilePath = this.getLogFilePath()
    }

    try {
      appendFileSync(this.logFilePath, `${message}\n`, 'utf-8')
    }
    catch {
      // Silently fail to avoid infinite loop of errors
      // Console output will still show the error
    }
  }
}

/**
 * Global logger options
 */
interface GlobalLoggerOptions {
  workspaceRoot?: string
  logDir?: string
  enableConsole?: boolean
  enableFile?: boolean
}

let globalOptions: GlobalLoggerOptions = {}

/**
 * Set global logging options that will be used for all new loggers
 */
export function setGlobalLoggerOptions(options: GlobalLoggerOptions): void {
  globalOptions = { ...globalOptions, ...options }
}

/**
 * Get global logging options
 */
export function getGlobalLoggerOptions(): GlobalLoggerOptions {
  return { ...globalOptions }
}

/**
 * Create a logger instance with optional file output
 */
export function createLogger(tag: string, optionsOrLevel?: LogLevel | LoggerOptions): Logger {
  // Handle legacy API: createLogger(tag, level)
  let options: LoggerOptions = {}
  if (typeof optionsOrLevel === 'string') {
    options = { level: optionsOrLevel }
  }
  else {
    options = optionsOrLevel ?? {}
  }

  const {
    level = 'info',
    dir = 'logs',
    workspaceRoot = globalOptions.workspaceRoot ?? getDefaultWorkspaceRoot(),
    enableConsole = true,
    enableFile = true
  } = options

  // Resolve log directory to absolute path
  const resolvedLogDir = resolveLogDir(dir, workspaceRoot)

  const currentLevelRef = { value: level }
  const fileWriter = enableFile ? new LogFileWriter(resolvedLogDir) : null

  function createLogFunction(
    logTag: string,
    logLevel: LogLevel
  ): (message: string, data?: LogData | Error) => void {
    return (message: string, data?: LogData | Error) => {
      if (LEVEL_ORDER[logLevel] < LEVEL_ORDER[currentLevelRef.value]) {
        return
      }

      const timestamp = formatTime(new Date())
      const tagStr = `[${logTag}]`
      const levelStr = padLevel(logLevel.toUpperCase())

      // Format data string
      let dataStr = ''
      if (data) {
        if (data instanceof Error) {
          dataStr = ` ${data.message}${data.stack ? `\n${data.stack}` : ''}`
        }
        else {
          dataStr = ` ${JSON.stringify(data)}`
        }
      }

      // Plain log line for file (no colors)
      const plainMsg = `${timestamp} ${levelStr} ${tagStr} ${message}${dataStr}`

      // Console output (with colors)
      if (enableConsole) {
        const color = COLORS[logLevel]
        const consoleMsg = `${COLORS.dim}${timestamp}${COLORS.reset} ${color}${levelStr}${COLORS.reset} ${tagStr} ${message}${dataStr}`
        // eslint-disable-next-line no-console
        console.log(consoleMsg)
      }

      // File output
      if (fileWriter) {
        fileWriter.write(plainMsg)
      }
    }
  }

  return {
    debug: createLogFunction(tag, 'debug'),
    info: createLogFunction(tag, 'info'),
    success: createLogFunction(tag, 'success'),
    warn: createLogFunction(tag, 'warn'),
    error: createLogFunction(tag, 'error'),
    setLevel(newLevel: LogLevel) {
      currentLevelRef.value = newLevel
    }
  }
}

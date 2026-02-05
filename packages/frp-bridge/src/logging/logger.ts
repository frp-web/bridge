import type { LogData, Logger, LoggerOptions, LoggingLogLevel } from './types'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const LEVEL_ORDER: Record<LoggingLogLevel, number> = {
  debug: 0,
  info: 1,
  success: 1,
  warn: 2,
  error: 3
}

const COLORS = {
  reset: '\x1B[0m', // 重置
  dim: '\x1B[2m', // 暗淡
  debug: '\x1B[36m', // 青色
  info: '\x1B[34m', // 蓝色
  success: '\x1B[32m', // 绿色
  warn: '\x1B[33m', // 黄色
  error: '\x1B[31m' // 红色
}

function formatTime(date: Date): string {
  const yyyy = date.getFullYear()
  const MM = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const HH = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`
}

function padLevel(level: string): string {
  return level.padEnd(7)
}

function createLogFunction(
  tag: string,
  level: LoggingLogLevel,
  currentLevelRef: { value: LoggingLogLevel },
  filePath?: string
): (message: string, data?: LogData | Error) => void {
  return (message: string, data?: LogData | Error) => {
    // Check log level
    if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevelRef.value]) {
      return
    }

    const timestamp = formatTime(new Date())
    const tagStr = `[${tag}]`
    const levelStr = padLevel(level.toUpperCase())
    const dataStr = data ? ` ${JSON.stringify(data)}` : ''

    // Console output (with colors)
    const color = COLORS[level]
    const consoleMsg = `${COLORS.dim}${timestamp}${COLORS.reset} ${color}${tagStr}${COLORS.reset} ${levelStr} ${message}${dataStr}`
    // eslint-disable-next-line no-console
    console.info(consoleMsg)

    // File output (no colors)
    if (filePath) {
      try {
        const dir = dirname(filePath)
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true })
        }
        const fileMsg = `${timestamp} ${tagStr} ${levelStr} ${message}${dataStr}\n`
        appendFileSync(filePath, fileMsg, 'utf-8')
      }
      catch {
        // Silent fail
      }
    }
  }
}

export function createLogger(tag: string, options: LoggerOptions = {}): Logger {
  const {
    level = 'info',
    file
  } = options

  const currentLevelRef = { value: level }

  return {
    debug: createLogFunction(tag, 'debug', currentLevelRef, file),
    info: createLogFunction(tag, 'info', currentLevelRef, file),
    success: createLogFunction(tag, 'success', currentLevelRef, file),
    warn: createLogFunction(tag, 'warn', currentLevelRef, file),
    error: createLogFunction(tag, 'error', currentLevelRef, file),
    setLevel(newLevel: LoggingLogLevel) {
      currentLevelRef.value = newLevel
    }
  }
}

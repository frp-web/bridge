# 日志系统实现指南

自定义日志系统的完整实现。

## 核心实现

### 1. 类型定义

```typescript
// src/logging/types.ts

export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error'

export interface LoggerOptions {
  level?: LogLevel
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
  setLevel: (level: LogLevel) => void
}
```

### 2. Logger 实现

```typescript
// src/logging/logger.ts

import type { LogData, Logger, LoggerOptions, LogLevel } from './types'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// 日志级别优先级
const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  success: 1,
  warn: 2,
  error: 3
}

// 终端颜色代码
const COLORS = {
  reset: '\x1B[0m', // 重置
  dim: '\x1B[2m', // 暗淡（用于时间戳）
  debug: '\x1B[36m', // 青色
  info: '\x1B[34m', // 蓝色
  success: '\x1B[32m', // 绿色
  warn: '\x1B[33m', // 黄色
  error: '\x1B[31m' // 红色
}

// 格式化时间戳
function formatTime(date: Date): string {
  const yyyy = date.getFullYear()
  const MM = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const HH = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`
}

// 填充级别字符串到固定宽度
function padLevel(level: string): string {
  return level.padEnd(7)
}

// 创建日志函数
function createLogFunction(
  tag: string,
  level: LogLevel,
  currentLevelRef: { value: LogLevel },
  filePath?: string
): (message: string, data?: LogData | Error) => void {
  return (message: string, data?: LogData | Error) => {
    // 检查日志级别
    if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevelRef.value]) {
      return
    }

    const timestamp = formatTime(new Date())
    const tagStr = `[${tag}]`
    const levelStr = padLevel(level.toUpperCase())
    const dataStr = data ? ` ${JSON.stringify(data)}` : ''

    // 控制台输出（带颜色）
    const color = COLORS[level]
    const consoleMsg = `${COLORS.dim}${timestamp}${COLORS.reset} ${color}${tagStr}${COLORS.reset} ${levelStr} ${message}${dataStr}`
    console.log(consoleMsg)

    // 文件输出（无颜色）
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
        // 静默失败
      }
    }
  }
}

// 创建日志器
export function createLogger(tag: string, options: LoggerOptions = {}): Logger {
  const {
    level = 'info',
    file,
    timestamp = true
  } = options

  const currentLevelRef = { value: level }

  return {
    debug: createLogFunction(tag, 'debug', currentLevelRef, file),
    info: createLogFunction(tag, 'info', currentLevelRef, file),
    success: createLogFunction(tag, 'success', currentLevelRef, file),
    warn: createLogFunction(tag, 'warn', currentLevelRef, file),
    error: createLogFunction(tag, 'error', currentLevelRef, file),
    setLevel(newLevel: LogLevel) {
      currentLevelRef.value = newLevel
    }
  }
}
```

### 3. 导出

```typescript
// src/logging/index.ts

export { createLogger } from './logger'
export type { LogData, Logger, LoggerOptions, LogLevel } from './types'
```

### 4. 主入口导出

```typescript
// src/index.ts

export * from './logging'
// ... 其他导出
```

## 设计说明

### 颜色输出

使用 ANSI 转义码实现终端彩色输出：

```typescript
const COLORS = {
  reset: '\x1B[0m', // 重置
  dim: '\x1B[2m', // 暗淡（用于时间戳）
  debug: '\x1B[36m', // 青色
  info: '\x1B[34m', // 蓝色
  success: '\x1B[32m', // 绿色
  warn: '\x1B[33m', // 黄色
  error: '\x1B[31m' // 红色
}
```

### 日志级别过滤

使用数值比较实现日志级别过滤：

```typescript
const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  success: 1,
  warn: 2,
  error: 3
}

// 只有当当前级别 >= 设定级别时才输出
if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevelRef.value]) {
  // 跳过此日志
}
```

### 文件输出

文件输出不包含 ANSI 颜色代码，便于日志解析：

```typescript
// 控制台：带颜色
const consoleMsg = `${COLORS.dim}${timestamp}${COLORS.reset} ...`

// 文件：纯文本
const fileMsg = `${timestamp} ${tagStr} ${levelStr} ${message}${dataStr}\n`
```

## 使用示例

### 为不同模块创建日志器

```typescript
// 为不同模块创建日志器
import { createLogger } from 'frp-bridge'

// src/rpc/logger.ts
export const rpcLogger = createLogger('RPC', {
  file: './logs/rpc.log'
})

// src/process/logger.ts
export const processLogger = createLogger('Process', {
  file: './logs/process.log'
})
```

### 运行时调整级别

```typescript
const logger = createLogger('MyModule')

// 生产环境只显示警告及以上
logger.setLevel('warn')

// 开发时开启调试
logger.setLevel('debug')
```

### 结构化数据

```typescript
// 使用对象传递结构化数据
logger.info('User logged in', {
  userId: 123,
  username: 'alice',
  ip: '192.168.1.100'
})
```

### 错误处理

```typescript
// 记录 Error 对象
try {
  await someOperation()
}
catch (error) {
  logger.error('Operation failed', error)
}
```

## 输出格式

### 控制台输出（带颜色）

```
2026-02-05 14:30:45 [RPC] INFO    Server started {"port":7000}
2026-02-05 14:30:46 [RPC] SUCCESS Connection established
2026-02-05 14:30:47 [RPC] WARN    High memory usage {"usage":"90%"}
2026-02-05 14:30:48 [RPC] ERROR   Connection failed
```

### 文件输出（纯文本）

```
2026-02-05 14:30:45 [RPC] INFO    Server started {"port":7000}
2026-02-05 14:30:46 [RPC] SUCCESS Connection established
2026-02-05 14:30:47 [RPC] WARN    High memory usage {"usage":"90%"}
2026-02-05 14:30:48 [RPC] ERROR   Connection failed
```

## 最佳实践

### 1. 使用有意义的标签

```typescript
// 好的标签
const apiLogger = createLogger('API')
const dbLogger = createLogger('Database')
const wsLogger = createLogger('WebSocket')

// 不好的标签
const logger1 = createLogger('log1')
const l1 = createLogger('logger')
```

### 2. 为每个模块创建独立日志器

```typescript
// src/rpc/index.ts
export const logger = createLogger('RPC')

// src/process/index.ts
export const logger = createLogger('Process')

// src/config/index.ts
export const logger = createLogger('Config')
```

### 3. 使用结构化数据

```typescript
// 好的做法
logger.info('Tunnel added', {
  name: 'ssh',
  type: 'tcp',
  localPort: 22,
  remotePort: 6000
})

// 不好的做法
logger.info('Tunnel ssh tcp 22 6000 added')
```

### 4. 正确的错误处理

```typescript
// 好的做法
try {
  await connect()
}
catch (error) {
  logger.error('Connection failed', error)
}

// 不好的做法
try {
  await connect()
}
catch (error) {
  logger.error('Connection failed') // 丢失了错误信息
}
```

## 环境变量配置

```typescript
const logger = createLogger('Main', {
  level: (process.env.LOG_LEVEL as LogLevel) || 'info',
  file: process.env.LOG_FILE
})
```

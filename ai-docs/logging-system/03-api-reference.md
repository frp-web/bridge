# 日志 API 参考

`createLogger` 函数和 Logger 接口的完整 API 参考。

## createLogger()

```typescript
function createLogger(tag: string, options?: LoggerOptions): Logger
```

创建一个带标签的日志器实例。

### 参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `tag` | `string` | - | 日志标签，会显示在每条日志前 |
| `options.level` | `LogLevel` | `'info'` | 日志级别 |
| `options.file` | `string` | - | 日志文件路径 |
| `options.timestamp` | `boolean` | `true` | 是否显示时间戳 |

### 返回值

返回一个 `Logger` 对象。

### 示例

```typescript
// 基础用法
const logger = createLogger('Main')

// 带选项
const logger = createLogger('RPC', {
  level: 'debug',
  file: './logs/rpc.log',
  timestamp: true
})
```

## Logger 接口

```typescript
interface Logger {
  debug: (message: string, data?: LogData) => void
  info: (message: string, data?: LogData) => void
  success: (message: string, data?: LogData) => void
  warn: (message: string, data?: LogData) => void
  error: (message: string, error?: Error | LogData) => void
  setLevel: (level: LogLevel) => void
}
```

### debug()

```typescript
// debug(message: string, data?: LogData): void
```

记录调试级别日志。只在 `level` 设置为 `debug` 时输出。

```typescript
logger.debug('Processing request', { requestId: 123 })
logger.debug('Variable value', { count: 42 })
```

### info()

```typescript
// info(message: string, data?: LogData): void
```

记录信息级别日志。默认级别，记录一般信息。

```typescript
logger.info('Server started', { port: 3000 })
logger.info('User logged in', { userId: 123 })
logger.info('File saved', { path: '/tmp/file.txt' })
```

### success()

```typescript
// success(message: string, data?: LogData): void
```

记录成功级别日志。用于操作成功的情况。

```typescript
logger.success('Operation completed')
logger.success('Email sent', { to: 'user@example.com' })
```

### warn()

```typescript
// warn(message: string, data?: LogData): void
```

记录警告级别日志。表示潜在问题但不影响运行。

```typescript
logger.warn('High memory usage', { usage: '90%' })
logger.warn('Deprecated API called', { method: 'oldMethod' })
logger.warn('Slow query', { duration: 5000 })
```

### error()

```typescript
// error(message: string, error?: Error | LogData): void
```

记录错误级别日志。用于记录操作失败或异常。

```typescript
// 记录 Error 对象
try {
  await someOperation()
}
catch (err) {
  logger.error('Operation failed', err)
}

// 记录自定义数据
logger.error('Connection failed', {
  host: 'localhost',
  port: 7000,
  code: 'ECONNREFUSED'
})
```

### setLevel()

```typescript
// setLevel(level: LogLevel): void
```

运行时调整日志级别。

```typescript
logger.setLevel('debug') // 显示所有日志
logger.setLevel('warn') // 只显示 warn、error
logger.setLevel('error') // 只显示 error
```

## 日志级别

| 级别 | 优先级 | 说明 | 使用场景 |
|------|--------|------|----------|
| `debug` | 0 | 最详细，用于开发调试 | 函数入参、中间值 |
| `info` | 1 | 一般信息，生产环境默认 | 操作完成、状态变更 |
| `success` | 1 | 成功信息 | 操作成功 |
| `warn` | 2 | 警告信息 | 降级运行、性能问题 |
| `error` | 3 | 错误信息 | 操作失败 |

## 输出格式

### 控制台输出

```
2026-02-05 14:30:45 [TAG] INFO    Server started {"port":3000}
```

- `2026-02-05 14:30:45` - 时间戳（暗淡色）
- `[TAG]` - 日志标签（彩色）
- `INFO` - 日志级别（固定宽度 7 字符）
- `Server started` - 消息
- `{"port":3000}` - 附加数据（可选）

### 文件输出

```
2026-02-05 14:30:45 [TAG] INFO    Server started {"port":3000}
```

与控制台格式相同，但无 ANSI 颜色代码。

## 颜色映射

| 级别 | 颜色 | ANSI 代码 |
|------|------|-----------|
| `debug` | 青色 | `\x1b[36m` |
| `info` | 蓝色 | `\x1b[34m` |
| `success` | 绿色 | `\x1b[32m` |
| `warn` | 黄色 | `\x1b[33m` |
| `error` | 红色 | `\x1b[31m` |

## LogData 类型

```typescript
interface LogData {
  [key: string]: unknown
}
```

任意键值对对象，会被 JSON 序列化后追加到日志。

## 类型定义

```typescript
type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error'

interface LoggerOptions {
  level?: LogLevel
  file?: string
  timestamp?: boolean
}
```

## 完整示例

```typescript
import { createLogger } from 'frp-bridge'

// 1. 创建多个日志器
const mainLogger = createLogger('Main', {
  level: 'info',
  file: './logs/main.log'
})

const rpcLogger = createLogger('RPC', {
  level: 'debug',
  file: './logs/rpc.log'
})

// 2. 记录日志
mainLogger.info('Application starting')
mainLogger.info('Environment', { env: 'production' })

rpcLogger.debug('Connection details', {
  host: 'localhost',
  port: 7000
})

// 3. 成功消息
rpcLogger.success('Connected to server')

// 4. 警告
mainLogger.warn('High memory usage', { usage: '85%' })

// 5. 错误处理
try {
  await connect()
}
catch (err) {
  rpcLogger.error('Connection failed', err)
}

// 6. 调整级别
mainLogger.setLevel('warn') // 只显示 warn 和 error
```

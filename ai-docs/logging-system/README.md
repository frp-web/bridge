# 日志系统

frp-bridge 内置的轻量级日志系统。

## 使用

```typescript
import { createLogger } from 'frp-bridge'

const logger = createLogger('RPC', {
  level: 'info',
  file: './logs/rpc.log'
})

logger.info('Server started', { port: 7000 })
logger.success('Connection established')
logger.warn('High memory usage', { usage: '90%' })
logger.error('Connection failed', new Error('ECONNREFUSED'))
```

## 输出格式

```
2026-02-05 14:30:45 [RPC] INFO    Server started {"port":7000}
2026-02-05 14:30:46 [RPC] SUCCESS Connection established
```

## 日志级别

| 级别 | 说明 |
|------|------|
| `debug` | 调试信息 |
| `info` | 一般信息 |
| `success` | 成功信息 |
| `warn` | 警告信息 |
| `error` | 错误信息 |

## API

```text
createLogger(tag: string, options?: LoggerOptions): Logger

interface LoggerOptions {
  level?: LogLevel
  file?: string
  timestamp?: boolean
}

interface Logger {
  debug: (message: string, data?: LogData) => void
  info: (message: string, data?: LogData) => void
  success: (message: string, data?: LogData) => void
  warn: (message: string, data?: LogData) => void
  error: (message: string, error?: Error | LogData) => void
  setLevel: (level: LogLevel) => void
}
```

## 实现文件

```
packages/frp-bridge/src/logging/
├── index.ts
├── logger.ts
└── types.ts
```

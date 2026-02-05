# WebSocket 客户端

frpc Nuxt 端的 WebSocket 客户端实现，负责连接到 frps 并接收命令。

## 实现文件

**文件路径**: `composables/useRpcChannel.ts`

## 完整代码

```typescript
import { WebSocket } from 'ws'

export function useRpcChannel(nodeId: string) {
  let ws: WebSocket | null = null
  let reconnectTimer: NodeJS.Timeout | null = null
  const reconnectDelay = 5000 // 5秒重连间隔

  /**
   * 连接到 frps WebSocket 服务器
   */
  async function connect() {
    // 如果已经连接，先断开
    if (ws) {
      ws.close()
    }

    const wsUrl = `ws://your-domain.com:7000/api/rpc/ws?nodeId=${nodeId}`

    try {
      ws = new WebSocket(wsUrl)

      ws.on('open', () => {
        console.log(`[RPC Client] Connected to server as ${nodeId}`)
        // 清除重连定时器
        if (reconnectTimer) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }
      })

      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString())
          console.log(`[RPC Client] Received:`, msg)
          await handleCommand(msg)
        }
        catch (error) {
          console.error(`[RPC Client] Message parse error:`, error)
        }
      })

      ws.on('close', (code, reason) => {
        console.log(`[RPC Client] Disconnected: ${code} - ${reason}`)
        // 自动重连
        scheduleReconnect()
      })

      ws.on('error', (error) => {
        console.error(`[RPC Client] WebSocket error:`, error)
        // 错误也会触发 close 事件
      })
    }
    catch (error) {
      console.error(`[RPC Client] Connection error:`, error)
      scheduleReconnect()
    }
  }

  /**
   * 安排重连
   */
  function scheduleReconnect() {
    if (reconnectTimer)
      return

    reconnectTimer = setTimeout(() => {
      console.log(`[RPC Client] Reconnecting...`)
      reconnectTimer = null
      connect()
    }, reconnectDelay)
  }

  /**
   * 断开连接
   */
  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    if (ws) {
      ws.close()
      ws = null
    }
  }

  /**
   * 发送消息到服务器
   */
  function send(message: any): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[RPC Client] Not connected')
      return false
    }

    try {
      ws.send(JSON.stringify(message))
      return true
    }
    catch (error) {
      console.error('[RPC Client] Send error:', error)
      return false
    }
  }

  /**
   * 处理来自服务器的命令
   */
  async function handleCommand(msg: any) {
    // 只处理命令类型消息
    if (msg.type !== 'command') {
      console.warn(`[RPC Client] Ignoring non-command message:`, msg)
      return
    }

    switch (msg.action) {
      case 'tunnel.add':
        await handleTunnelAdd(msg)
        break

      case 'tunnel.delete':
        await handleTunnelDelete(msg)
        break

      case 'node.delete':
        await handleNodeDelete(msg)
        break

      default:
        console.warn(`[RPC Client] Unknown action: ${msg.action}`)
        sendErrorResponse(msg, 'Unknown action')
    }
  }

  /**
   * 处理添加隧道命令
   */
  async function handleTunnelAdd(msg: any) {
    try {
      // 调用本地 bridge API
      const result = await $fetch('/api/bridge/tunnel', {
        method: 'POST',
        body: msg.payload
      })

      // 返回成功事件
      send({
        type: 'event',
        action: 'tunnel.added',
        payload: {
          success: true,
          tunnel: result
        },
        id: msg.id
      })

      console.log(`[RPC Client] Tunnel ${msg.payload.name} added successfully`)
    }
    catch (error) {
      console.error(`[RPC Client] Tunnel add failed:`, error)

      // 返回失败事件
      send({
        type: 'event',
        action: 'tunnel.added',
        payload: {
          success: false,
          error: error.message
        },
        id: msg.id
      })
    }
  }

  /**
   * 处理删除隧道命令
   */
  async function handleTunnelDelete(msg: any) {
    try {
      await $fetch(`/api/bridge/tunnel/${msg.payload.name}`, {
        method: 'DELETE'
      })

      send({
        type: 'event',
        action: 'tunnel.deleted',
        payload: { success: true },
        id: msg.id
      })

      console.log(`[RPC Client] Tunnel ${msg.payload.name} deleted successfully`)
    }
    catch (error) {
      console.error(`[RPC Client] Tunnel delete failed:`, error)

      send({
        type: 'event',
        action: 'tunnel.deleted',
        payload: {
          success: false,
          error: error.message
        },
        id: msg.id
      })
    }
  }

  /**
   * 处理删除节点命令
   */
  async function handleNodeDelete(msg: any) {
    try {
      await $fetch(`/api/bridge/node/${msg.payload.name}`, {
        method: 'DELETE'
      })

      send({
        type: 'event',
        action: 'node.deleted',
        payload: { success: true },
        id: msg.id
      })

      console.log(`[RPC Client] Node ${msg.payload.name} deleted successfully`)
    }
    catch (error) {
      console.error(`[RPC Client] Node delete failed:`, error)

      send({
        type: 'event',
        action: 'node.deleted',
        payload: {
          success: false,
          error: error.message
        },
        id: msg.id
      })
    }
  }

  /**
   * 发送错误响应
   */
  function sendErrorResponse(originalMsg: any, errorMessage: string) {
    send({
      type: 'event',
      action: `${originalMsg.action}.error`,
      payload: {
        success: false,
        error: errorMessage
      },
      id: originalMsg.id
    })
  }

  return {
    connect,
    disconnect,
    send
  }
}
```

## 插件初始化

**文件路径**: `plugins/rpc.client.ts`

```typescript
export default defineNuxtPlugin(() => {
  // 生成唯一节点 ID
  const hostname = process.env.HOSTNAME || 'unknown'
  const timestamp = Date.now()
  const nodeId = `frpc-${hostname}-${timestamp}`

  console.log(`[RPC Plugin] Initializing with nodeId: ${nodeId}`)

  // 创建 RPC 客户端
  const channel = useRpcChannel(nodeId)

  // 连接到服务器
  channel.connect()

  // 应用关闭时断开连接
  process.on('beforeExit', () => {
    channel.disconnect()
  })

  // 提供 channel 给全局使用
  return {
    provide: {
      rpcChannel: channel
    }
  }
})
```

## 核心功能

### 1. 连接管理

#### 建立连接

```typescript
const channel = useRpcChannel('frpc-12345')
await channel.connect()
```

#### 自动重连

```typescript
function scheduleReconnect() {
  if (reconnectTimer)
    return

  reconnectTimer = setTimeout(() => {
    console.log(`[RPC Client] Reconnecting...`)
    reconnectTimer = null
    connect()
  }, reconnectDelay)
}
```

当连接断开时，自动在 5 秒后尝试重连。

#### 主动断开

```typescript
channel.disconnect()
```

### 2. 消息处理

#### 命令路由

```typescript
async function handleCommand(msg: any) {
  if (msg.type !== 'command') {
    return
  }

  switch (msg.action) {
    case 'tunnel.add':
      await handleTunnelAdd(msg)
      break
    case 'tunnel.delete':
      await handleTunnelDelete(msg)
      break
    case 'node.delete':
      await handleNodeDelete(msg)
      break
  }
}
```

#### 错误处理

```typescript
try {
  const result = await $fetch('/api/bridge/tunnel', {
    method: 'POST',
    body: msg.payload
  })

  send({
    type: 'event',
    action: 'tunnel.added',
    payload: { success: true },
    id: msg.id
  })
}
catch (error) {
  send({
    type: 'event',
    action: 'tunnel.added',
    payload: { success: false, error: error.message },
    id: msg.id
  })
}
```

### 3. 响应发送

#### 成功响应

```typescript
send({
  type: 'event',
  action: 'tunnel.added',
  payload: {
    success: true,
    tunnel: result
  },
  id: msg.id // 引用原命令 ID
})
```

#### 失败响应

```typescript
send({
  type: 'event',
  action: 'tunnel.added',
  payload: {
    success: false,
    error: 'Local service unavailable'
  },
  id: msg.id
})
```

## 配置选项

### 环境变量

```bash
# .env
RPC_SERVER_URL=ws://your-domain.com:7000/api/rpc/ws
RPC_NODE_ID=frpc-prod-01
RPC_RECONNECT_DELAY=5000
```

### 使用配置

```typescript
export function useRpcChannel(nodeId: string) {
  const config = useRuntimeConfig()

  const wsUrl = config.public.rpcServerUrl || 'ws://localhost:7000/api/rpc/ws'
  const reconnectDelay = config.rpcReconnectDelay || 5000

  // ...
}
```

`nuxt.config.ts`:

```typescript
export default defineNuxtConfig({
  runtimeConfig: {
    rpcReconnectDelay: 5000,
    public: {
      rpcServerUrl: ''
    }
  }
})
```

## 高级功能

### 心跳检测

```typescript
let heartbeatTimer: NodeJS.Timeout | null = null

ws.on('open', () => {
  // 启动心跳
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.ping()
    }
  }, 30000)
})

ws.on('pong', () => {
  console.log('[RPC Client] Received pong')
})

ws.on('close', () => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
})
```

### 消息队列

```typescript
const messageQueue: any[] = []
let isProcessing = false

function send(message: any): boolean {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message))
    return true
  }

  // 离线时加入队列
  messageQueue.push(message)
  return false
}

ws.on('open', () => {
  // 发送队列中的消息
  if (!isProcessing) {
    processQueue()
  }
})

async function processQueue() {
  isProcessing = true

  while (messageQueue.length > 0 && ws?.readyState === WebSocket.OPEN) {
    const msg = messageQueue.shift()
    ws.send(JSON.stringify(msg))
  }

  isProcessing = false
}
```

### 命令超时

```typescript
const pendingCommands = new Map<string, NodeJS.Timeout>()

async function handleCommand(msg: any) {
  if (!msg.id)
    return

  // 设置超时
  const timeout = setTimeout(() => {
    send({
      type: 'event',
      action: `${msg.action}.timeout`,
      payload: { error: 'Command timeout' },
      id: msg.id
    })
  }, 30000) // 30秒超时

  pendingCommands.set(msg.id, timeout)

  try {
    await executeCommand(msg)
  }
  finally {
    clearTimeout(timeout)
    pendingCommands.delete(msg.id)
  }
}
```

## 状态管理

### 连接状态

```typescript
export function useRpcChannel(nodeId: string) {
  const connectionState = ref<'connecting' | 'connected' | 'disconnected'>('disconnected')

  ws.on('open', () => {
    connectionState.value = 'connected'
  })

  ws.on('close', () => {
    connectionState.value = 'disconnected'
  })

  return {
    connect,
    disconnect,
    send,
    connectionState
  }
}
```

### 统计信息

```typescript
const stats = reactive({
  messagesReceived: 0,
  messagesSent: 0,
  commandsExecuted: 0,
  errors: 0
})

ws.on('message', () => {
  stats.messagesReceived++
})

function send(message: any): boolean {
  stats.messagesSent++
  // ...
}

async function handleCommand(msg: any) {
  try {
    await executeCommand(msg)
    stats.commandsExecuted++
  }
  catch (error) {
    stats.errors++
  }
}
```

## 调试

### 详细日志

```typescript
const DEBUG = process.env.RPC_DEBUG === 'true'

function log(...args: any[]) {
  if (DEBUG) {
    console.log(`[RPC Client ${nodeId}]`, ...args)
  }
}

ws.on('message', (data) => {
  log('Received:', data.toString())
})
```

### 消息跟踪

```typescript
const messageTracer = new Map<string, number>()

ws.on('message', async (data) => {
  const msg = JSON.parse(data.toString())
  const startTime = Date.now()

  messageTracer.set(msg.id, startTime)

  await handleCommand(msg)

  const duration = Date.now() - startTime
  log(`Command ${msg.action} completed in ${duration}ms`)
})
```

## 使用示例

### 在组件中使用

```vue
<script setup lang="ts">
const { $rpcChannel } = useNuxtApp()

// 发送事件
function sendEvent() {
  $rpcChannel.send({
    type: 'event',
    action: 'custom.event',
    payload: { data: 'hello' }
  })
}

// 检查连接状态
if ($rpcChannel.connectionState.value === 'connected') {
  console.log('RPC is connected')
}
</script>
```

### 在 API 中使用

```typescript
// server/api/status.get.ts
export default defineEventHandler((event) => {
  const channel = event.context.rpcChannel

  return {
    connected: channel.connectionState.value === 'connected',
    nodeId: channel.nodeId,
    stats: channel.stats
  }
})
```

## 错误处理最佳实践

### 网络错误

```typescript
ws.on('error', (error) => {
  if (error.code === 'ECONNREFUSED') {
    console.error('[RPC Client] Server unreachable')
  }
  else if (error.code === 'ENOTFOUND') {
    console.error('[RPC Client] DNS resolution failed')
  }
  else {
    console.error('[RPC Client] Unknown error:', error)
  }
})
```

### 消息验证

```typescript
function isValidMessage(msg: any): boolean {
  return (
    msg
    && typeof msg === 'object'
    && ['command', 'event'].includes(msg.type)
    && typeof msg.action === 'string'
    && msg.payload !== undefined
  )
}

ws.on('message', async (data) => {
  try {
    const msg = JSON.parse(data.toString())

    if (!isValidMessage(msg)) {
      console.warn('[RPC Client] Invalid message format')
      return
    }

    await handleCommand(msg)
  }
  catch (error) {
    console.error('[RPC Client] Message processing error:', error)
  }
})
```

### 优雅关闭

```typescript
let isShuttingDown = false

process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)

async function gracefulShutdown() {
  if (isShuttingDown)
    return

  isShuttingDown = true
  console.log('[RPC Client] Shutting down...')

  // 等待待处理命令完成
  if (pendingCommands.size > 0) {
    console.log(`[RPC Client] Waiting for ${pendingCommands.size} commands...`)
    await new Promise(resolve => setTimeout(resolve, 5000))
  }

  disconnect()
  process.exit(0)
}
```

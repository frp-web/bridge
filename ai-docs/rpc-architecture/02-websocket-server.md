# WebSocket 服务器

frps Nuxt 端的 WebSocket 服务器实现，负责管理和路由所有 frpc 客户端的连接。

## 实现文件

**文件路径**: `server/api/rpc/ws.ts`

## 完整代码

```typescript
import { WebSocket, WebSocketServer } from 'ws'

// 存储所有连接的客户端：nodeId -> WebSocket
const clients = new Map<string, WebSocket>()

// WebSocket 服务器实例
let wss: WebSocketServer | null = null

export default defineEventHandler((event) => {
  // 检查是否为 WebSocket 升级请求
  if (event.node.req.headers.upgrade !== 'websocket') {
    return { error: 'Expected WebSocket' }
  }

  // 初始化 WebSocket 服务器（仅第一次）
  if (!wss) {
    wss = new WebSocketServer({ noServer: true })

    // 新连接处理
    wss.on('connection', (ws, req) => {
      // 从 URL 参数获取节点 ID
      const nodeId = new URL(req.url, 'ws://').searchParams.get('nodeId')

      if (!nodeId) {
        ws.close(1008, 'Missing nodeId parameter')
        return
      }

      // 存储连接
      clients.set(nodeId, ws)
      console.log(`[RPC] Node connected: ${nodeId}`)

      // 消息处理
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())
          console.log(`[RPC] Message from ${nodeId}:`, msg)
          // 可以在这里添加消息路由逻辑
        }
        catch (error) {
          console.error(`[RPC] Invalid message from ${nodeId}:`, error)
        }
      })

      // 连接关闭处理
      ws.on('close', () => {
        clients.delete(nodeId)
        console.log(`[RPC] Node disconnected: ${nodeId}`)
      })

      // 错误处理
      ws.on('error', (error) => {
        console.error(`[RPC] WebSocket error for ${nodeId}:`, error)
        clients.delete(nodeId)
      })
    })
  }

  // 升级 HTTP 连接到 WebSocket
  return new Promise((resolve) => {
    wss.handleUpgrade(
      event.node.req,
      event.node.req.socket,
      // eslint-disable-next-line node/prefer-global/buffer
      Buffer.alloc(0),
      (ws) => {
        wss.emit('connection', ws, event.node.req)
        resolve({ upgraded: true })
      }
    )
  })
})

// 导出：向指定节点发送消息
export function sendToNode(nodeId: string, message: any): boolean {
  const ws = clients.get(nodeId)

  if (!ws) {
    console.error(`[RPC] Node not found: ${nodeId}`)
    return false
  }

  if (ws.readyState !== WebSocket.OPEN) {
    console.error(`[RPC] Node not ready: ${nodeId}`)
    return false
  }

  try {
    ws.send(JSON.stringify(message))
    return true
  }
  catch (error) {
    console.error(`[RPC] Send failed to ${nodeId}:`, error)
    return false
  }
}

// 导出：获取所有在线节点
export function getOnlineNodes(): string[] {
  return Array.from(clients.keys())
}

// 导出：检查节点是否在线
export function isNodeOnline(nodeId: string): boolean {
  const ws = clients.get(nodeId)
  return ws !== undefined && ws.readyState === WebSocket.OPEN
}

// 导出：广播消息到所有节点
export function broadcast(message: any): void {
  const data = JSON.stringify(message)

  for (const [nodeId, ws] of clients.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(data)
      }
      catch (error) {
        console.error(`[RPC] Broadcast failed to ${nodeId}:`, error)
      }
    }
  }
}
```

## 核心功能

### 1. 连接管理

#### 连接建立

```text
ws://domain:7000/api/rpc/ws?nodeId=frpc-12345
```

**参数说明**:
- `nodeId`: 客户端唯一标识，建议格式 `frpc-{timestamp}` 或 `frpc-{hostname}`

**连接流程**:
1. 客户端发起 WebSocket 连接请求
2. 服务器验证 `upgrade` 头
3. 提取 `nodeId` 参数
4. 将连接存储到 `clients` Map
5. 注册消息处理器

#### 连接存储

```typescript
const clients = new Map<string, WebSocket>()
```

**数据结构**:
- Key: `nodeId` (string)
- Value: `WebSocket` 实例

### 2. 消息发送

#### 单点发送

```typescript
// 向指定节点发送消息
sendToNode('frpc-1', {
  type: 'command',
  action: 'tunnel.add',
  payload: { /* ... */ },
  id: crypto.randomUUID()
})
```

**返回值**: `boolean` - 发送是否成功

#### 广播发送

```typescript
// 向所有在线节点发送消息
broadcast({
  type: 'event',
  action: 'system.restart',
  payload: { timestamp: Date.now() }
})
```

### 3. 状态查询

#### 获取在线节点列表

```typescript
const onlineNodes = getOnlineNodes()
// 返回: ['frpc-1', 'frpc-2', 'frpc-3']
```

#### 检查节点在线状态

```typescript
if (isNodeOnline('frpc-1')) {
  // 节点在线
}
```

## 消息处理

### 接收消息流程

```typescript
ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString())
    console.log(`[RPC] Message from ${nodeId}:`, msg)

    // 可以扩展消息路由
    handleRpcMessage(nodeId, msg)
  }
  catch (error) {
    console.error(`[RPC] Invalid message from ${nodeId}:`, error)
  }
})
```

### 消息路由示例

```typescript
async function handleRpcMessage(nodeId: string, msg: RpcMessage) {
  switch (msg.action) {
    case 'tunnel.added':
      // 处理隧道添加完成事件
      await handleTunnelAdded(nodeId, msg.payload)
      break

    case 'node.deleted':
      // 处理节点删除完成事件
      await handleNodeDeleted(nodeId, msg.payload)
      break

    default:
      console.warn(`[RPC] Unknown action: ${msg.action}`)
  }
}
```

## 连接生命周期

### 连接状态

```typescript
WebSocket.CONNECTING = 0 // 正在连接
WebSocket.OPEN = 1 // 已连接
WebSocket.CLOSING = 2 // 正在关闭
WebSocket.CLOSED = 3 // 已关闭
```

### 自动清理

```typescript
ws.on('close', () => {
  clients.delete(nodeId)
  console.log(`[RPC] Node disconnected: ${nodeId}`)
})
```

当客户端断开连接时，自动从 `clients` Map 中移除。

## 错误处理

### 缺少 nodeId

```typescript
if (!nodeId) {
  ws.close(1008, 'Missing nodeId parameter')
}
```

**关闭代码**: 1008 (Policy Violation)

### 发送失败

```typescript
try {
  ws.send(JSON.stringify(message))
  return true
}
catch (error) {
  console.error(`[RPC] Send failed to ${nodeId}:`, error)
  return false
}
```

### 连接错误

```typescript
ws.on('error', (error) => {
  console.error(`[RPC] WebSocket error for ${nodeId}:`, error)
  clients.delete(nodeId)
})
```

## 使用示例

### 在 API 中使用

```typescript
// server/api/admin/tunnel-add.post.ts
import { isNodeOnline, sendToNode } from '../rpc/ws'

export default defineEventHandler(async (event) => {
  const { nodeId, tunnel } = await readBody(event)

  // 检查节点是否在线
  if (!isNodeOnline(nodeId)) {
    throw createError({
      statusCode: 404,
      message: `Node ${nodeId} is not online`
    })
  }

  // 发送命令
  const success = sendToNode(nodeId, {
    type: 'command',
    action: 'tunnel.add',
    payload: tunnel,
    id: crypto.randomUUID()
  })

  if (!success) {
    throw createError({
      statusCode: 500,
      message: 'Failed to send command'
    })
  }

  return { success: true }
})
```

### 在 Server Middleware 中使用

```typescript
// server/middleware/rpc-monitor.ts
import { getOnlineNodes } from '../api/rpc/ws'

export default defineEventHandler((event) => {
  // 添加 RPC 状态到响应头
  event.node.res.setHeader('X-RPC-Nodes', getOnlineNodes().length)
})
```

## 安全建议

### 1. 连接验证

```typescript
// 添加 Token 验证
const token = new URL(req.url, 'ws://').searchParams.get('token')

if (token !== process.env.RPC_SECRET) {
  ws.close(1008, 'Invalid token')
}
```

### 2. 限流

```typescript
const connectionCount = clients.get(nodeId)?.connectionCount || 0

if (connectionCount > MAX_CONNECTIONS_PER_NODE) {
  ws.close(1008, 'Too many connections')
}
```

### 3. 消息大小限制

```typescript
const MAX_MESSAGE_SIZE = 1024 * 1024 // 1MB

ws.on('message', (data) => {
  if (data.length > MAX_MESSAGE_SIZE) {
    ws.close(1009, 'Message too large')
  }
  // ...
})
```

## 调试

### 启用详细日志

```typescript
const DEBUG = process.env.RPC_DEBUG === 'true'

function log(...args: any[]) {
  if (DEBUG) {
    console.log('[RPC]', ...args)
  }
}
```

### 监控连接数

```typescript
setInterval(() => {
  console.log(`[RPC] Active connections: ${clients.size}`)
}, 60000)
```

## 性能优化

### 1. 心跳检测

```typescript
// 在服务器中添加心跳检测
const heartbeats = new Map<string, NodeJS.Timeout>()

// 以下代码添加到 connection 事件处理中
// const heartbeat = setInterval(() => {
//   if (ws.readyState === WebSocket.OPEN) {
//     ws.ping()
//   } else {
//     clearInterval(heartbeat)
//     heartbeats.delete(nodeId)
//   }
// }, 30000)
//
// heartbeats.set(nodeId, heartbeat)
//
// ws.on('close', () => {
//   clearInterval(heartbeat)
//   heartbeats.delete(nodeId)
// })
```

### 2. 消息队列

```typescript
const messageQueues = new Map<string, any[]>()

function queueMessage(nodeId: string, message: any) {
  if (!messageQueues.has(nodeId)) {
    messageQueues.set(nodeId, [])
  }
  messageQueues.get(nodeId)!.push(message)
}
```

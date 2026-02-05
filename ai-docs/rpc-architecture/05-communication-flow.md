# 通讯流程

完整的 RPC 消息交互流程示例和详细说明。

## 场景 1: 添加隧道

### 完整流程图

```
┌─────────────┐                     ┌─────────────┐                     ┌─────────────┐
│  frps Nuxt  │                     │ WebSocket   │                     │  frpc Nuxt  │
│  Admin UI   │                     │   Channel   │                     │    Client   │
└──────┬──────┘                     └──────┬──────┘                     └──────┬──────┘
       │                                   │                                   │
       │  1. POST /api/admin/tunnel-add   │                                   │
       │---------------------------------->│                                   │
       │  body: {                          │                                   │
       │    nodeId: "frpc-1",              │                                   │
       │    tunnel: {                      │                                   │
       │      name: "ssh",                 │                                   │
       │      type: "tcp",                 │                                   │
       │      localPort: 22,               │                                   │
       │      remotePort: 6000             │                                   │
       │    }                              │                                   │
       │  }                                │                                   │
       │                                   │                                   │
       │                                   │  2. WS Command                   │
       │                                   │---------------------------------->│
       │                                   │  {                               │
       │                                   │    type: "command",              │
       │                                   │    action: "tunnel.add",         │
       │                                   │    payload: { /* ... */ },             │
       │                                   │    id: "uuid-123"                │
       │                                   │  }                               │
       │                                   │                                   │
       │                                   │                                   │  3. POST /api/bridge/tunnel
       │                                   │                                   │  body: { name: "ssh", ... }
       │                                   │                                   │---------------------------------->
       │                                   │                                   │
       │                                   │  4. WS Event                     │  5. Return result
       │                                   │<----------------------------------│  { success: true, ... }
       │                                   │  {                               │
       │  6. API Response                 │    type: "event",                │
       │<----------------------------------│    action: "tunnel.added",       │
       │  {                               │    payload: {                    │
       │    success: true,                │      success: true               │
       │    commandId: "uuid-123"         │    },                            │
       │  }                               │    id: "uuid-123"                │
       │                                   │  }                               │
```

### 详细步骤

#### 步骤 1: 管理页面发起请求

```typescript
// frps Nuxt 管理页面
async function addTunnelToNode() {
  const result = await $fetch('/api/admin/tunnel-add', {
    method: 'POST',
    body: {
      nodeId: 'frpc-1',
      tunnel: {
        name: 'ssh',
        type: 'tcp',
        localPort: 22,
        remotePort: 6000
      }
    }
  })

  console.log(result.message)
  // "Tunnel ssh creation command sent to frpc-1"
}
```

**请求详情**:
- **URL**: `/api/admin/tunnel-add`
- **Method**: `POST`
- **Body**:
  - `nodeId`: 目标客户端 ID
  - `tunnel`: 隧道配置对象

#### 步骤 2: API 转发到 WebSocket

```typescript
// server/api/admin/tunnel-add.post.ts
export default defineEventHandler(async (event) => {
  const { nodeId, tunnel } = await readBody(event)

  // 验证节点在线状态
  if (!isNodeOnline(nodeId)) {
    throw createError({
      statusCode: 404,
      message: `Node ${nodeId} is not online`
    })
  }

  // 生成唯一命令 ID
  const commandId = crypto.randomUUID()

  // 通过 WebSocket 发送命令
  sendToNode(nodeId, {
    type: 'command',
    action: 'tunnel.add',
    payload: tunnel,
    id: commandId
  })

  return {
    success: true,
    commandId,
    message: `Tunnel ${tunnel.name} creation command sent to ${nodeId}`
  }
})
```

**消息详情**:
```json
{
  "type": "command",
  "action": "tunnel.add",
  "payload": {
    "name": "ssh",
    "type": "tcp",
    "localPort": 22,
    "remotePort": 6000
  },
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### 步骤 3: frpc 接收并处理命令

```typescript
// composables/useRpcChannel.ts (frpc 端)
ws.on('message', async (data) => {
  const msg = JSON.parse(data.toString())
  await handleCommand(msg)
})

async function handleCommand(msg: any) {
  if (msg.action === 'tunnel.add') {
    await handleTunnelAdd(msg)
  }
}

async function handleTunnelAdd(msg: any) {
  try {
    // 调用本地 bridge API
    const result = await $fetch('/api/bridge/tunnel', {
      method: 'POST',
      body: msg.payload
    })

    // 成功响应
    ws.send(JSON.stringify({
      type: 'event',
      action: 'tunnel.added',
      payload: { success: true, tunnel: result },
      id: msg.id
    }))
  }
  catch (error) {
    // 失败响应
    ws.send(JSON.stringify({
      type: 'event',
      action: 'tunnel.added',
      payload: { success: false, error: error.message },
      id: msg.id
    }))
  }
}
```

#### 步骤 4: 本地 API 执行

```typescript
// server/api/bridge/tunnel.post.ts (frpc 端)
export default defineEventHandler(async (event) => {
  const tunnel = await readBody(event)

  // 实际执行隧道创建逻辑
  // 例如: 配置 frpc、启动代理等

  return {
    name: tunnel.name,
    type: tunnel.type,
    status: 'active',
    createdAt: Date.now()
  }
})
```

#### 步骤 5-6: 响应返回

```text
// WebSocket 事件
{
  "type": "event",
  "action": "tunnel.added",
  "payload": {
    "success": true,
    "tunnel": {
      "name": "ssh",
      "type": "tcp",
      "status": "active",
      "createdAt": 1737547200000
    }
  },
  "id": "550e8400-e29b-41d4-a716-446655440000"
}

// HTTP 响应
{
  "success": true,
  "commandId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Tunnel ssh creation command sent to frpc-1"
}
```

## 场景 2: 删除节点

### 流程时序图

```
┌─────────────┐                     ┌─────────────┐                     ┌─────────────┐
│  frps Nuxt  │                     │ WebSocket   │                     │  frpc Nuxt  │
│  Admin UI   │                     │   Channel   │                     │    Client   │
└──────┬──────┘                     └──────┬──────┘                     └──────┬──────┘
       │                                   │                                   │
       │  1. POST /api/admin/node-delete   │                                   │
       │---------------------------------->│                                   │
       │  body: {                          │                                   │
       │    nodeId: "frpc-2",              │                                   │
       │    targetName: "old-node-123"     │                                   │
       │  }                                │                                   │
       │                                   │                                   │
       │                                   │  2. WS Command                   │
       │                                   │---------------------------------->│
       │                                   │  {                               │
       │                                   │    type: "command",              │
       │  3. API Response                 │    action: "node.delete",        │
       │<----------------------------------│    payload: {                    │
       │  {                               │      name: "old-node-123"        │
       │    success: true                 │    },                            │
       │  }                               │    id: "uuid-456"                │
       │                                   │  }                               │
       │                                   │                                   │
       │                                   │                                   │  4. DELETE /api/bridge/node/old-node-123
       │                                   │                                   │---------------------------------->
       │                                   │  5. WS Event                     │
       │                                   │<----------------------------------│  { success: true }
       │                                   │  {                               │
       │                                   │    type: "event",                │
       │                                   │    action: "node.deleted",       │
       │                                   │    payload: { success: true },   │
       │                                   │    id: "uuid-456"                │
       │                                   │  }                               │
```

### 代码示例

#### 管理页面

```typescript
async function deleteNodeFromClient() {
  try {
    const result = await $fetch('/api/admin/node-delete', {
      method: 'POST',
      body: {
        nodeId: 'frpc-2',
        targetName: 'old-node-123'
      }
    })

    console.log(result.message)
    // "Node old-node-123 deletion command sent to frpc-2"
  }
  catch (error) {
    console.error('Failed to delete node:', error)
  }
}
```

#### frpc 处理

```typescript
async function handleNodeDelete(msg: any) {
  try {
    await $fetch(`/api/bridge/node/${msg.payload.name}`, {
      method: 'DELETE'
    })

    // 返回成功
    ws.send(JSON.stringify({
      type: 'event',
      action: 'node.deleted',
      payload: { success: true },
      id: msg.id
    }))
  }
  catch (error) {
    // 返回失败
    ws.send(JSON.stringify({
      type: 'event',
      action: 'node.deleted',
      payload: { success: false, error: error.message },
      id: msg.id
    }))
  }
}
```

## 场景 3: 错误处理

### 离线节点

```
┌─────────────┐                     ┌─────────────┐
│  frps Nuxt  │                     │ WebSocket   │
│  Admin UI   │                     │   Channel   │
└──────┬──────┘                     └──────┬──────┘
       │                                   │
       │  1. POST /api/admin/tunnel-add   │
       │---------------------------------->│
       │  nodeId: "offline-node"          │
       │                                   │
       │  2. 检查在线状态                  │
       │  isNodeOnline("offline-node")    │
       │  => false                        │
       │                                   │
       │  3. HTTP 404 Error               │
       │<----------------------------------│
       │  {                               │
       │    statusCode: 404,              │
       │    message: "Node offline-node   │
       │               is not online"     │
       │  }                               │
```

### 执行失败

```
┌─────────────┐                     ┌─────────────┐                     ┌─────────────┐
│  frps Nuxt  │                     │ WebSocket   │                     │  frpc Nuxt  │
│  Admin UI   │                     │   Channel   │                     │    Client   │
└──────┬──────┘                     └──────┬──────┘                     └──────┬──────┘
       │                                   │                                   │
       │  1. Command sent                  │                                   │
       │---------------------------------->│  2. Receive command               │
       │                                   │<----------------------------------│
       │                                   │                                   │
       │                                   │  3. Execute locally               │
       │                                   │                                   │  4. POST /api/bridge/tunnel
       │                                   │                                   │---------------------------------->
       │                                   │                                   │  Error: Port already in use
       │                                   │  5. Event with error             │  6. Return error
       │                                   │<----------------------------------│<----------------------------------
       │                                   │  {                               │
       │                                   │    type: "event",                │
       │                                   │    action: "tunnel.added",       │
       │                                   │    payload: {                    │
       │                                   │      success: false,             │
       │                                   │      error: "Port 22 already     │
       │                                   │               in use"            │
       │                                   │    },                            │
       │                                   │    id: "uuid-123"                │
       │                                   │  }                               │
```

## 场景 4: 批量操作

### 批量添加隧道

```typescript
// 管理页面
async function addMultipleTunnels() {
  const operations = [
    { nodeId: 'frpc-1', tunnel: { name: 'ssh', type: 'tcp', localPort: 22 } },
    { nodeId: 'frpc-2', tunnel: { name: 'web', type: 'http', localPort: 8080 } },
    { nodeId: 'frpc-3', tunnel: { name: 'db', type: 'tcp', localPort: 3306 } }
  ]

  const result = await $fetch('/api/admin/tunnel-batch-add', {
    method: 'POST',
    body: { operations }
  })

  console.log(`Total: ${result.total}`)
  console.log(`Successful: ${result.successful}`)
  console.log(`Failed: ${result.failed}`)
  console.log('Details:', result.results)
}
```

### 响应示例

```json
{
  "total": 3,
  "successful": 2,
  "failed": 1,
  "results": [
    {
      "nodeId": "frpc-1",
      "success": true,
      "tunnelName": "ssh"
    },
    {
      "nodeId": "frpc-2",
      "success": true,
      "tunnelName": "web"
    },
    {
      "nodeId": "frpc-3",
      "success": false,
      "error": "Node not online"
    }
  ]
}
```

## 场景 5: 节点重连

### 重连流程

```
┌─────────────┐                     ┌─────────────┐
│  frpc Nuxt  │                     │ WebSocket   │
│    Client   │                     │   Server    │
└──────┬──────┘                     └──────┬──────┘
       │                                   │
       │  1. 连接断开                       │
       │  (网络故障/服务器重启)             │
       │                                   │
       │  2. 5秒后尝试重连                  │
       │---------------------------------->│
       │  ws://server:7000/api/rpc/ws?     │
       │      nodeId=frpc-123              │
       │                                   │
       │  3. 连接成功                       │
       │<----------------------------------│
       │  ws.on('open')                    │
       │                                   │
       │  4. 恢复服务                       │
       │  ready to receive commands        │
```

### 代码实现

```typescript
// frpc 端
ws.on('close', (code, reason) => {
  console.log(`Disconnected: ${code} - ${reason}`)

  // 安排重连
  setTimeout(() => {
    console.log('Reconnecting...')
    connect()
  }, 5000)
})
```

## 消息格式对比

### 命令消息 (frps → frpc)

```json
{
  "type": "command",
  "action": "tunnel.add",
  "payload": {
    "name": "ssh",
    "type": "tcp",
    "localPort": 22,
    "remotePort": 6000
  },
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**关键字段**:
- `type`: 必须是 `"command"`
- `action`: 要执行的操作
- `payload`: 操作数据
- `id`: 必须包含，用于响应匹配

### 事件消息 (frpc → frps)

```json
{
  "type": "event",
  "action": "tunnel.added",
  "payload": {
    "success": true,
    "tunnel": {
      "name": "ssh",
      "status": "active"
    }
  },
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**关键字段**:
- `type`: 必须是 `"event"`
- `action`: 操作的过去式
- `payload`: 包含执行结果
- `id`: 引用原命令的 ID

## 超时处理

### 客户端超时

```typescript
async function handleCommand(msg: any) {
  const timeout = 30000 // 30秒

  const result = await Promise.race([
    executeCommand(msg),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeout)
    )
  ])

  // 发送响应
  ws.send(JSON.stringify({
    type: 'event',
    action: `${msg.action}.completed`,
    payload: result,
    id: msg.id
  }))
}
```

### 服务器端超时

```typescript
const pendingCommands = new Map<string, NodeJS.Timeout>()

export function sendToNode(nodeId: string, message: any): boolean {
  const ws = clients.get(nodeId)
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false
  }

  // 设置超时监控
  if (message.type === 'command' && message.id) {
    const timeout = setTimeout(() => {
      console.warn(`Command ${message.id} timeout`)
      // 可以记录到日志或发送通知
    }, 60000) // 60秒超时

    pendingCommands.set(message.id, timeout)
  }

  ws.send(JSON.stringify(message))
  return true
}
```

## 消息确认机制

### 可靠传输

```typescript
// 发送方
const messageId = crypto.randomUUID()

const message = {
  type: 'command',
  action: 'tunnel.add',
  payload: { /* ... */ },
  id: messageId,
  requireAck: true // 需要确认
}

// 等待确认
const waitForAck = new Promise((resolve) => {
  const timeout = setTimeout(() => {
    resolve({ success: false, error: 'No acknowledgment' })
  }, 10000)

  // 监听确认
  const handler = (ack) => {
    if (ack.id === messageId) {
      clearTimeout(timeout)
      ws.off('message', handler)
      resolve(ack.payload)
    }
  }

  ws.on('message', handler)
})

ws.send(JSON.stringify(message))
const result = await waitForAck
```

## 调试追踪

### 消息日志

```typescript
// 服务器端
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())

  console.log(`[${new Date().toISOString()}] `
    + `Message from ${nodeId}: `
    + `${msg.action} (${msg.id})`)

  // 记录到文件
  logToFile({
    timestamp: Date.now(),
    direction: 'inbound',
    nodeId,
    message: msg
  })
})

// 客户端
function send(message: any) {
  console.log(`[${new Date().toISOString()}] `
    + `Sending to server: `
    + `${message.action} (${message.id})`)

  ws.send(JSON.stringify(message))
}
```

### 性能监控

```typescript
// 记录命令执行时间
const metrics = new Map<string, number>()

async function handleCommand(msg: any) {
  const startTime = Date.now()

  try {
    await executeCommand(msg)

    const duration = Date.now() - startTime
    metrics.set(msg.action, (metrics.get(msg.action) || 0) + duration)

    console.log(`Command ${msg.action} took ${duration}ms`)
  }
  catch (error) {
    console.error(`Command ${msg.action} failed:`, error)
  }
}

// 定期输出统计
setInterval(() => {
  console.log('Command performance:')
  for (const [action, totalTime] of metrics.entries()) {
    console.log(`  ${action}: ${totalTime}ms total`)
  }
  metrics.clear()
}, 60000)
```

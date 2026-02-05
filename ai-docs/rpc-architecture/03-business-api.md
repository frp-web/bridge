# 业务 API

frps Nuxt 端的管理接口实现，处理来自管理页面的请求并转发到对应的 frpc 节点。

## API 目录结构

```
server/api/admin/
├── tunnel-add.post.ts      # 添加隧道
├── tunnel-delete.post.ts   # 删除隧道
├── node-delete.post.ts     # 删除节点
└── nodes.get.ts            # 获取节点列表
```

## 隧道管理 API

### 添加隧道

**文件**: `server/api/admin/tunnel-add.post.ts`

```typescript
import { isNodeOnline, sendToNode } from '../rpc/ws'

export default defineEventHandler(async (event) => {
  const { nodeId, tunnel } = await readBody(event)

  // 参数验证
  if (!nodeId || !tunnel) {
    throw createError({
      statusCode: 400,
      message: 'Missing required parameters: nodeId, tunnel'
    })
  }

  // 验证隧道配置
  if (!tunnel.name || !tunnel.type || !tunnel.localPort) {
    throw createError({
      statusCode: 400,
      message: 'Invalid tunnel configuration'
    })
  }

  // 检查节点是否在线
  if (!isNodeOnline(nodeId)) {
    throw createError({
      statusCode: 404,
      message: `Node ${nodeId} is not online`
    })
  }

  // 生成命令 ID
  const commandId = crypto.randomUUID()

  // 发送命令到指定节点
  const success = sendToNode(nodeId, {
    type: 'command',
    action: 'tunnel.add',
    payload: {
      name: tunnel.name,
      type: tunnel.type,
      localPort: tunnel.localPort,
      remotePort: tunnel.remotePort
    },
    id: commandId
  })

  if (!success) {
    throw createError({
      statusCode: 500,
      message: 'Failed to send command to node'
    })
  }

  return {
    success: true,
    commandId,
    message: `Tunnel ${tunnel.name} creation command sent to ${nodeId}`
  }
})
```

**请求示例**:

```typescript
await $fetch('/api/admin/tunnel-add', {
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
```

**响应示例**:

```json
{
  "success": true,
  "commandId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Tunnel ssh creation command sent to frpc-1"
}
```

### 删除隧道

**文件**: `server/api/admin/tunnel-delete.post.ts`

```typescript
import { isNodeOnline, sendToNode } from '../rpc/ws'

export default defineEventHandler(async (event) => {
  const { nodeId, tunnelName } = await readBody(event)

  // 参数验证
  if (!nodeId || !tunnelName) {
    throw createError({
      statusCode: 400,
      message: 'Missing required parameters: nodeId, tunnelName'
    })
  }

  // 检查节点是否在线
  if (!isNodeOnline(nodeId)) {
    throw createError({
      statusCode: 404,
      message: `Node ${nodeId} is not online`
    })
  }

  // 发送删除命令
  const success = sendToNode(nodeId, {
    type: 'command',
    action: 'tunnel.delete',
    payload: { name: tunnelName },
    id: crypto.randomUUID()
  })

  if (!success) {
    throw createError({
      statusCode: 500,
      message: 'Failed to send command to node'
    })
  }

  return {
    success: true,
    message: `Tunnel ${tunnelName} deletion command sent to ${nodeId}`
  }
})
```

**请求示例**:

```typescript
await $fetch('/api/admin/tunnel-delete', {
  method: 'POST',
  body: {
    nodeId: 'frpc-1',
    tunnelName: 'ssh'
  }
})
```

## 节点管理 API

### 删除节点

**文件**: `server/api/admin/node-delete.post.ts`

```typescript
import { isNodeOnline, sendToNode } from '../rpc/ws'

export default defineEventHandler(async (event) => {
  const { nodeId, targetName } = await readBody(event)

  // 参数验证
  if (!nodeId || !targetName) {
    throw createError({
      statusCode: 400,
      message: 'Missing required parameters: nodeId, targetName'
    })
  }

  // 检查节点是否在线
  if (!isNodeOnline(nodeId)) {
    throw createError({
      statusCode: 404,
      message: `Node ${nodeId} is not online`
    })
  }

  // 发送删除命令
  const success = sendToNode(nodeId, {
    type: 'command',
    action: 'node.delete',
    payload: { name: targetName },
    id: crypto.randomUUID()
  })

  if (!success) {
    throw createError({
      statusCode: 500,
      message: 'Failed to send command to node'
    })
  }

  return {
    success: true,
    message: `Node ${targetName} deletion command sent to ${nodeId}`
  }
})
```

**请求示例**:

```typescript
await $fetch('/api/admin/node-delete', {
  method: 'POST',
  body: {
    nodeId: 'frpc-2',
    targetName: 'old-node-123'
  }
})
```

### 获取在线节点列表

**文件**: `server/api/admin/nodes.get.ts`

```typescript
import { getOnlineNodes } from '../rpc/ws'

export default defineEventHandler((event) => {
  const onlineNodes = getOnlineNodes()

  return {
    nodes: onlineNodes,
    count: onlineNodes.length,
    timestamp: Date.now()
  }
})
```

**请求示例**:

```typescript
const result = await $fetch('/api/admin/nodes')
```

**响应示例**:

```json
{
  "nodes": ["frpc-1", "frpc-2", "frpc-3"],
  "count": 3,
  "timestamp": 1737547200000
}
```

## 错误处理

### 统一错误格式

```typescript
export default defineEventHandler(async (event) => {
  try {
    // API 逻辑
  }
  catch (error) {
    throw createError({
      statusCode: 500,
      message: error.message,
      data: {
        endpoint: '/api/admin/tunnel-add',
        timestamp: Date.now()
      }
    })
  }
})
```

### 错误码说明

| 状态码 | 说明 |
|--------|------|
| 400 | 参数缺失或无效 |
| 404 | 节点不存在或离线 |
| 500 | 发送命令失败 |

## 高级功能

### 批量操作

**文件**: `server/api/admin/tunnel-batch-add.post.ts`

```typescript
import { isNodeOnline, sendToNode } from '../rpc/ws'

export default defineEventHandler(async (event) => {
  const { operations } = await readBody(event)

  const results = []

  for (const op of operations) {
    const { nodeId, tunnel } = op

    if (!isNodeOnline(nodeId)) {
      results.push({
        nodeId,
        success: false,
        error: 'Node not online'
      })
      continue
    }

    const success = sendToNode(nodeId, {
      type: 'command',
      action: 'tunnel.add',
      payload: tunnel,
      id: crypto.randomUUID()
    })

    results.push({
      nodeId,
      success,
      tunnelName: tunnel.name
    })
  }

  return {
    total: operations.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results
  }
})
```

**请求示例**:

```typescript
await $fetch('/api/admin/tunnel-batch-add', {
  method: 'POST',
  body: {
    operations: [
      {
        nodeId: 'frpc-1',
        tunnel: { name: 'ssh', type: 'tcp', localPort: 22, remotePort: 6000 }
      },
      {
        nodeId: 'frpc-2',
        tunnel: { name: 'web', type: 'http', localPort: 8080 }
      }
    ]
  }
})
```

### 命令追踪

**文件**: `server/api/admin/command-status.get.ts`

```typescript
// 存储命令状态
const commandStatus = new Map<string, {
  nodeId: string
  action: string
  status: 'pending' | 'completed' | 'failed'
  result?: any
  timestamp: number
}>()

// 在发送命令时记录
export default defineEventHandler((event) => {
  const { commandId } = getQuery(event)

  const status = commandStatus.get(commandId as string)

  if (!status) {
    throw createError({
      statusCode: 404,
      message: 'Command not found'
    })
  }

  return status
})
```

## 前端集成示例

### Vue 组件

```vue
<template>
  <div>
    <select v-model="selectedNode">
      <option v-for="node in nodes" :key="node" :value="node">
        {{ node }}
      </option>
    </select>

    <input v-model="newTunnel.name" placeholder="Tunnel name">
    <input v-model.number="newTunnel.localPort" type="number" placeholder="Local port">

    <button @click="addTunnel">
      Add Tunnel
    </button>
  </div>
</template>

<script setup lang="ts">
const nodes = ref([])
const selectedNode = ref('')
const newTunnel = reactive({
  name: '',
  type: 'tcp',
  localPort: 0,
  remotePort: 0
})

// 加载节点列表
async function loadNodes() {
  const result = await $fetch('/api/admin/nodes')
  nodes.value = result.nodes
}

// 添加隧道
async function addTunnel() {
  try {
    const result = await $fetch('/api/admin/tunnel-add', {
      method: 'POST',
      body: {
        nodeId: selectedNode.value,
        tunnel: { ...newTunnel }
      }
    })

    alert(result.message)
  }
  catch (error) {
    alert(`Failed: ${error.message}`)
  }
}

onMounted(() => {
  loadNodes()
})
</script>
```

## 安全增强

### API 密钥验证

```typescript
// server/middleware/api-auth.ts
export default defineEventHandler((event) => {
  if (event.node.req.url?.startsWith('/api/admin')) {
    const apiKey = event.node.req.headers['x-api-key']

    if (apiKey !== process.env.ADMIN_API_KEY) {
      throw createError({
        statusCode: 401,
        message: 'Unauthorized'
      })
    }
  }
})
```

### 速率限制

```typescript
// server/utils/rate-limit.ts
const rateLimit = new Map<string, { count: number, resetTime: number }>()

export function checkRateLimit(
  identifier: string,
  limit: number = 10,
  window: number = 60000
): boolean {
  const now = Date.now()
  const record = rateLimit.get(identifier)

  if (!record || now > record.resetTime) {
    rateLimit.set(identifier, { count: 1, resetTime: now + window })
    return true
  }

  if (record.count >= limit) {
    return false
  }

  record.count++
  return true
}
```

## 测试

### 单元测试示例

```typescript
// tests/api/admin/tunnel-add.test.ts
import { describe, expect, it, vi } from 'vitest'
import { sendToNode } from '~/server/api/rpc/ws'

vi.mock('~/server/api/rpc/ws')

describe('POST /api/admin/tunnel-add', () => {
  it('should send tunnel add command', async () => {
    vi.mocked(sendToNode).mockReturnValue(true)

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

    expect(result.success).toBe(true)
    expect(sendToNode).toHaveBeenCalledWith(
      'frpc-1',
      expect.objectContaining({
        action: 'tunnel.add'
      })
    )
  })
})
```

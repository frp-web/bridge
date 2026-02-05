# 类型定义

RPC 通信中使用的所有数据类型定义。

## 核心类型

### RpcMessage

所有 RPC 通信的基础消息结构。

```typescript
// types/rpc.ts
export interface RpcMessage {
  type: 'command' | 'event' // 消息类型：命令或事件
  action: string // 具体操作名称
  payload: any // 操作负载数据
  id?: string // 消息唯一标识（用于命令追踪）
  targetNodeId?: string // 目标节点 ID（可选）
}
```

**字段说明**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `'command' \| 'event'` | 是 | 消息类型，`command` 表示命令下发，`event` 表示事件上报 |
| `action` | `string` | 是 | 操作名称，如 `tunnel.add`、`node.delete` |
| `payload` | `any` | 是 | 操作相关的数据，根据 `action` 不同而变化 |
| `id` | `string` | 否 | 命令的唯一标识，用于请求-响应匹配 |
| `targetNodeId` | `string` | 否 | 目标节点 ID，用于广播场景 |

### TunnelAddPayload

添加隧道时的负载数据。

```typescript
export interface TunnelAddPayload {
  name: string // 隧道名称
  type: 'tcp' | 'http' // 隧道类型
  localPort: number // 本地端口
  remotePort?: number // 远程端口（可选）
}
```

**字段说明**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 是 | 隧道唯一标识 |
| `type` | `'tcp' \| 'http'` | 是 | 隧道类型 |
| `localPort` | `number` | 是 | 需要映射的本地服务端口 |
| `remotePort` | `number` | 否 | TCP 类型时使用，指定 frps 上的端口 |

**示例**:

```typescript
// TCP 隧道
const tcpTunnel: TunnelAddPayload = {
  name: 'ssh',
  type: 'tcp',
  localPort: 22,
  remotePort: 6000
}

// HTTP 隧道
const httpTunnel: TunnelAddPayload = {
  name: 'webapp',
  type: 'http',
  localPort: 8080
}
```

## 消息类型详解

### Command (命令)

由 frps 发送到 frpc 的指令型消息。

```typescript
interface CommandMessage extends RpcMessage {
  type: 'command'
  id: string // 必须包含，用于追踪响应
}

// 示例
const commandExample: CommandMessage = {
  type: 'command',
  action: 'tunnel.add',
  payload: { /* ... */ },
  id: '550e8400-e29b-41d4-a716-446655440000'
}
```

### Event (事件)

由 frpc 发送到 frps 的响应型消息。

```typescript
interface EventMessage extends RpcMessage {
  type: 'event'
  id?: string // 引用对应的命令 ID
}

// 示例
const eventExample: EventMessage = {
  type: 'event',
  action: 'tunnel.added',
  payload: { success: true },
  id: '550e8400-e29b-41d4-a716-446655440000' // 引用命令 ID
}
```

## Action 命名规范

### 命令类 Actions (frps → frpc)

| Action | Payload | 说明 |
|--------|---------|------|
| `tunnel.add` | `TunnelAddPayload` | 添加新隧道 |
| `node.delete` | `{ name: string }` | 删除指定节点 |

### 事件类 Actions (frpc → frps)

| Action | Payload | 说明 |
|--------|---------|------|
| `tunnel.added` | `{ success: boolean }` | 隧道添加完成 |
| `tunnel.deleted` | `{ success: boolean }` | 隧道删除完成 |
| `node.deleted` | - | 节点删除完成 |

### 命名规则

- **命令**: 使用动词原形，如 `tunnel.add`、`node.delete`
- **事件**: 使用过去式，如 `tunnel.added`、`node.deleted`
- **格式**: `<domain>.<action>`

## 扩展类型

### NodeDeletePayload

```typescript
export interface NodeDeletePayload {
  name: string // 要删除的节点名称
}
```

### TunnelResponse

```typescript
export interface TunnelResponse {
  success: boolean
  error?: string
  tunnel?: TunnelAddPayload
}
```

### NodeResponse

```typescript
export interface NodeResponse {
  success: boolean
  error?: string
  deletedNode?: string
}
```

## 类型使用示例

### 发送命令

```typescript
// 在 frps 端
const command: RpcMessage = {
  type: 'command',
  action: 'tunnel.add',
  payload: {
    name: 'ssh',
    type: 'tcp',
    localPort: 22,
    remotePort: 6000
  },
  id: crypto.randomUUID()
}

sendToNode('frpc-1', command)
```

### 处理命令并返回事件

```typescript
// 在 frpc 端
async function handleCommand(msg: RpcMessage) {
  if (msg.action === 'tunnel.add') {
    const result = await addTunnel(msg.payload as TunnelAddPayload)

    const event: RpcMessage = {
      type: 'event',
      action: 'tunnel.added',
      payload: { success: result.success },
      id: msg.id // 引用原命令 ID
    }

    ws.send(JSON.stringify(event))
  }
}
```

## 类型验证

建议在运行时验证消息结构：

```typescript
function isRpcMessage(data: any): data is RpcMessage {
  return (
    typeof data === 'object'
    && (data.type === 'command' || data.type === 'event')
    && typeof data.action === 'string'
    && 'payload' in data
  )
}

function isTunnelAddPayload(data: any): data is TunnelAddPayload {
  return (
    typeof data === 'object'
    && typeof data.name === 'string'
    && (data.type === 'tcp' || data.type === 'http')
    && typeof data.localPort === 'number'
    && (data.remotePort === undefined || typeof data.remotePort === 'number')
  )
}
```

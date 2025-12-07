# WebSocket RPC 通讯机制设计

## 概述

**现状**：Client 端主动上报信息到 Server，单向通讯
**需求**：Server 需要主动控制 Client（如添加/更新隧道）
**方案**：基于 WebSocket 的双向 RPC 通讯

```
Client                          Server
  │                               │
  ├─ WebSocket 连接 ─────────────>│
  │<─── tunnel.add 命令 ──────────│
  │                               │
  ├─ 执行返回结果 ───────────────>│
  │                               │
  │<─── ping ─────────────────────│
  │                               │
  ├─ pong ───────────────────────>│
  │                               │
```

---

## 通讯协议

```typescript
// RPC 请求（Server → Client）
export interface RpcRequest {
  id: string
  method: string // tunnel.add, tunnel.update, tunnel.remove
  params: Record<string, unknown>
  timeout?: number // 默认 30s
}

// RPC 响应（Client → Server）
export interface RpcResponse {
  id: string
  status: 'success' | 'error'
  result?: unknown
  error?: { code: string, message: string }
}

// 心跳消息
export interface PingMessage { type: 'ping', timestamp: number }
export interface PongMessage { type: 'pong', timestamp: number }

// 注册消息（Client 连接时发送）
export interface RegisterMessage {
  type: 'register'
  nodeId: string
  payload: NodeInfo
}
```

---

## Server 端实现

```typescript
import { Buffer } from 'node:buffer'

export class RpcServer {
  private clients = new Map<string, WebSocket>()
  private pendingRequests = new Map<string, any>()

  onClientConnect(ws: WebSocket, nodeId: string) {
    this.clients.set(nodeId, ws)
    ws.on('message', (data: Uint8Array) => {
      const msg = JSON.parse(Buffer.from(data).toString())
      if (msg.id && msg.status) {
        this.handleRpcResponse(msg)
      }
    })
    ws.on('close', () => this.clients.delete(nodeId))
  }

  async rpcCall(nodeId: string, method: string, params: any, timeout = 30000): Promise<any> {
    const ws = this.clients.get(nodeId)
    if (!ws)
      throw new Error('Client not connected')

    const id = crypto.randomUUID()
    const request: RpcRequest = { id, method, params, timeout }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, timeout)

      this.pendingRequests.set(id, { resolve, reject, timer })
      ws.send(JSON.stringify(request))
    })
  }

  private handleRpcResponse(msg: RpcResponse) {
    const pending = this.pendingRequests.get(msg.id)
    if (!pending)
      return
    clearTimeout(pending.timer)
    this.pendingRequests.delete(msg.id)
    if (msg.status === 'success') {
      pending.resolve(msg.result)
    }
    else {
      pending.reject(new Error(msg.error?.message))
    }
  }

  // 启动心跳检测
  startHeartbeat() {
    setInterval(() => {
      this.clients.forEach((ws, nodeId) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }))
        }
        else {
          this.clients.delete(nodeId)
        }
      })
    }, 30000)
  }
}
```

## Client 端实现

```typescript
import { Buffer } from 'node:buffer'

export class RpcClient {
  private ws: WebSocket | null = null

  async connect(serverUrl: string, nodeId: string) {
    this.ws = new WebSocket(serverUrl)

    this.ws.on('open', () => {
      this.send({ type: 'register', nodeId, payload: this.collectNodeInfo() })
    })

    this.ws.on('message', (data: Uint8Array) => {
      const msg = JSON.parse(Buffer.from(data).toString())

      if (msg.type === 'ping') {
        this.send({ type: 'pong', timestamp: Date.now() })
      }
      else if (msg.method) {
        this.handleRpcRequest(msg)
      }
    })

    this.ws.on('close', () => {
      setTimeout(() => this.connect(serverUrl, nodeId), 5000) // 自动重连
    })
  }

  private async handleRpcRequest(req: RpcRequest) {
    try {
      let result: any
      if (req.method === 'tunnel.add') {
        result = await this.bridge.execute({ name: 'proxy.add', payload: req.params })
      }
      else if (req.method === 'tunnel.update') {
        result = await this.bridge.execute({ name: 'proxy.update', payload: req.params })
      }
      else if (req.method === 'tunnel.remove') {
        result = await this.bridge.execute({ name: 'proxy.remove', payload: req.params })
      }

      this.send({ id: req.id, status: 'success', result })
    }
    catch (error) {
      this.send({
        id: req.id,
        status: 'error',
        error: { code: 'EXECUTION_ERROR', message: error instanceof Error ? error.message : 'Unknown error' }
      })
    }
  }

  private send(msg: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }
}
```

---

## FrpBridge 集成

```typescript
export class FrpBridge {
  private rpcServer?: RpcServer
  private rpcClient?: RpcClient

  constructor(options: FrpBridgeOptions) {
    if (this.isServerMode) {
      this.rpcServer = new RpcServer()
      this.rpcServer.startHeartbeat()
    }

    if (this.isClientMode) {
      this.rpcClient = new RpcClient()
      this.rpcClient.connect(options.serverUrl, options.nodeId)
    }
  }

  // Server 端：远程添加隧道
  async addTunnelRemote(nodeId: string, tunnel: ProxyConfig) {
    if (!this.rpcServer)
      throw new Error('Not in server mode')
    return this.rpcServer.rpcCall(nodeId, 'tunnel.add', tunnel)
  }
}
```

---

## 可靠性保证

### 1. 自动重连
Client 连接断开时自动重连，间隔 5s

### 2. 请求超时
RPC 请求默认 30s 超时，Server 自动清理过期请求

### 3. 心跳保活
Server 每 30s 发送 ping，Client 立即响应 pong

---

## 安全性

### 1. 身份认证
WebSocket 握手时验证 token：
```typescript
const token = new URL(`ws://localhost${request.url}`).searchParams.get('token')
if (!validateToken(token))
  request.reject()
```

### 2. 命令授权
执行前检查权限：
```typescript
if (!isAuthorizedForMethod(nodeId, method)) {
  throw new Error('UNAUTHORIZED')
}
```

---

## 支持的方法

| 方法 | 参数 | 用途 |
|------|------|------|
| `tunnel.add` | ProxyConfig | 添加隧道 |
| `tunnel.update` | { name, config } | 更新隧道 |
| `tunnel.remove` | { name } | 删除隧道 |
| `config.update` | ClientConfig | 更新配置 |

---

## 使用示例

```typescript
// Server 侧：添加隧道
await bridge.addTunnelRemote('node-001', {
  name: 'web',
  type: 'http',
  localPort: 8080,
  customDomains: ['web.example.com']
})

// Server 侧：更新隧道
await bridge.rpcServer.rpcCall('node-001', 'tunnel.update', {
  name: 'web',
  config: { localPort: 9090 }
})

// Server 侧：删除隧道
await bridge.rpcServer.rpcCall('node-001', 'tunnel.remove', { name: 'web' })
```

---

## 技术栈

- **库**：`ws` (Node.js WebSocket)
- **协议**：WebSocket + JSON RPC
- **心跳**：30s 间隔
- **超时**：30s (可配置)
- **重连**：自动，5s 间隔

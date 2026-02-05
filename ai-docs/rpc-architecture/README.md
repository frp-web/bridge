# RPC 架构文档

基于 WebSocket 的双向 RPC 通信架构，用于 frps 与 frpc 之间的远程管理。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                         Internet                                │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  frps (:7000)                                                    │
│  ├─ vhostHTTPPort = 7000 (HTTP/WebSocket 复用)                  │
│  └─ Nuxt Server (内网 :3000) → HTTP Proxy → :7000               │
│                                                                   │
│  WebSocket Server: /api/rpc/ws                                   │
│  ├─ 管理多个 frpc 连接                                            │
│  └─ 路由命令到指定节点                                            │
└─────────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
         ┌─────────┐  ┌─────────┐  ┌─────────┐
         │ frpc-1  │  │ frpc-2  │  │ frpc-N  │
         │  Nuxt   │  │  Nuxt   │  │  Nuxt   │
         └─────────┘  └─────────┘  └─────────┘
              │             │             │
              └─────────────┴─────────────┘
                    WebSocket 连接
            ws://domain:7000/api/rpc/ws?nodeId=xxx
```

## 核心特性

1. **单端口复用**: HTTP 和 WebSocket 共享端口 7000
2. **双向通信**: 支持命令下发和结果上报
3. **多客户端管理**: frps 可管理多个 frpc 实例
4. **事件驱动**: 基于 RPC 消息的异步处理机制

## 文档目录

- [类型定义](./01-type-definitions.md) - RPC 消息和负载的数据结构
- [WebSocket 服务器](./02-websocket-server.md) - frps 端的 WebSocket 实现
- [业务 API](./03-business-api.md) - 管理接口的实现
- [WebSocket 客户端](./04-websocket-client.md) - frpc 端的客户端实现
- [通讯流程](./05-communication-flow.md) - 完整的消息交互流程
- [部署配置](./06-deployment-config.md) - frps 和部署配置示例

## 快速开始

### frps 端配置

```toml
# frps.toml
bindPort = 7000
vhostHTTPPort = 7000

[[proxies]]
name = "frps-nuxt"
type = "http"
localIP = "127.0.0.1"
localPort = 3000
customDomains = [ "your-domain.com" ]
```

### frpc 端初始化

```typescript
// plugins/rpc.client.ts
export default defineNuxtPlugin(() => {
  const nodeId = `frpc-${Date.now()}`
  const channel = useRpcChannel(nodeId)
  channel.connect()
})
```

### 消息发送示例

```typescript
// frps -> frpc
sendToNode('frpc-1', {
  type: 'command',
  action: 'tunnel.add',
  payload: {
    name: 'ssh',
    type: 'tcp',
    localPort: 22,
    remotePort: 6000
  },
  id: crypto.randomUUID()
})
```

## 技术栈

- **服务端**: Nuxt 3 + WebSocket (ws)
- **客户端**: Nuxt 3 + WebSocket Client
- **通信协议**: WebSocket over HTTP/1.1 Upgrade
- **数据格式**: JSON

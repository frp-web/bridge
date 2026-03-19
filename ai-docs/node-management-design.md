# Node Management 功能设计文档

## 概述

在 frp-bridge 项目中新增节点管理功能，支持 server 端对多个连接的 client 节点进行管理，client 端需要主动收集基础信息并上报给 server。

**设计目标：**
- Server 模式：被动接收并管理已连接 client 的节点信息，仅提供查询 API
- Client 模式：连接时主动上报节点信息，周期性心跳更新
- 类型安全：完整的 TypeScript 类型定义
- 遵循架构：Runtime Command/Query 模式

---

## FRP 原生能力分析

根据 frp 官方文档调查，**frps 原生不提供获取已连接 frpc 系统信息的直接 API**。

### frps 提供的能力

| 功能 | 包含内容 | 限制 |
|------|--------|------|
| **Dashboard** | 代理流量、连接数统计 | 不含客户端系统信息；API 不规范 |
| **Prometheus** | 性能指标 (/metrics) | 同上；仅指标导向 |
| **客户端信息** | **无法提供** | 需 Client 端主动上报 |

### 推荐方案：被动节点发现 + 主动心跳更新

```
Client 端初始化:
  ├─ 收集系统信息 (IP、CPU、内存、OS、版本)
  └─ 连接时上报 → node.register 命令 (创建节点)

Client 端运行中:
  └─ 定期心跳 → node.heartbeat 命令 (更新状态和信息)

Server 端:
  ├─ 被动接收 register/heartbeat → 自动创建/更新节点
  ├─ 集成 frps Dashboard API → 代理统计 (流量、连接数)
  └─ 节点只能查询，不支持人工增删改
```

---

## 类型定义 (`@frp-bridge/types`)

### 核心类型

```typescript
export interface NodeInfo {
  id: string // UUID
  name: string
  ip: string
  port: number
  protocol: 'tcp' | 'udp'
  serverAddr: string
  serverPort: number
  hostname?: string
  osType?: string // 'linux' | 'darwin' | 'win32'
  osRelease?: string
  platform?: string // 'x64' | 'arm64'
  cpuCores?: number
  memTotal?: number
  frpVersion?: string
  bridgeVersion?: string
  status: 'online' | 'offline' | 'connecting' | 'error'
  lastHeartbeat?: number
  connectedAt?: number
  labels?: Record<string, string>
  metadata?: Record<string, unknown>
  token?: string
  createdAt: number
  updatedAt: number
}

export interface NodeRegisterPayload {
  ip: string
  port: number
  serverAddr: string
  serverPort: number
  protocol: 'tcp' | 'udp'
  hostname: string
  osType: string
  osRelease: string
  platform: string
  cpuCores: number
  memTotal: number
  frpVersion: string
  bridgeVersion: string
  token?: string
}

export interface NodeHeartbeatPayload {
  nodeId: string
  status: 'online' | 'error'
  lastHeartbeat: number
  cpuCores?: number
  memTotal?: number
}

export interface NodeListQuery {
  page?: number
  pageSize?: number
  status?: NodeInfo['status']
  labels?: Record<string, string>
  search?: string
}

export interface NodeListResponse {
  items: NodeInfo[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}
```

## Runtime 命令和查询

### 客户端命令 (Server 自动处理)

| 命令 | 功能 | 事件 | 触发时机 |
|------|------|------|--------|
| `node.register` | Client 初始化时上报节点信息，Server 生成 UUID | `node:registered` | Client 启动 |
| `node.heartbeat` | Client 周期性上报心跳和最新系统信息 | `node:heartbeat` | 每 30-60s |
| `node.unregister` | Client 优雅关闭时通知 Server | `node:unregistered` | Client 退出 |

### Server 端查询 (外部 API)

| 查询 | 功能 | 返回 |
|------|------|------|
| `node.list` | 获取节点列表 (分页/过滤/搜索) | NodeListResponse |
| `node.get` | 获取单个节点详情 | NodeInfo |
| `node.stats` | 获取全局统计 (总数、在线数、离线数) | NodeStatistics |

**说明**: Server 端不提供任何修改节点的 API，节点生命周期由 Client 驱动。

---

## NodeManager 类设计

位置: `packages/core/src/node/node-manager.ts`

```typescript
export class NodeManager {
  // 内部命令 (由 Runtime handler 调用，不外部暴露)
  private async registerNode(payload: NodeRegisterPayload): Promise<NodeInfo>
  private async updateHeartbeat(payload: NodeHeartbeatPayload): Promise<void>
  private async unregisterNode(nodeId: string): Promise<void>

  // 公开查询方法
  async listNodes(query?: NodeListQuery): Promise<NodeListResponse>
  async getNode(id: string): Promise<NodeInfo>
  async getStatistics(): Promise<{ total: number, online: number, offline: number }>

  // 工具方法
  hasNode(id: string): boolean
  getOnlineNodes(): NodeInfo[]
  getOfflineNodes(): NodeInfo[]
  getNodesByStatus(status: NodeInfo['status']): NodeInfo[]

  // 生命周期
  async initialize(): Promise<void>
  async dispose(): Promise<void>
}

export interface NodeStorage {
  save: (node: NodeInfo) => Awaitable<void>
  delete: (id: string) => Awaitable<void>
  load: (id: string) => Awaitable<NodeInfo | undefined>
  list: () => Awaitable<NodeInfo[]>
}

export type NodeEvent = 'node:registered' | 'node:heartbeat' | 'node:unregistered' | 'node:statusChanged'
```

---

## Client 端信息收集

### ClientNodeCollector

位置: `packages/core/src/node/client-collector.ts`

**关键点**: frps 原生无法获取 frpc 系统信息，必须由 Client 端主动收集和上报。

```typescript
export class ClientNodeCollector {
  async collectNodeInfo(): Promise<Partial<NodeInfo>>
  startHeartbeat(interval?: number): void
  stopHeartbeat(): void
  async reportToServer(info: Partial<NodeInfo>): Promise<void>
}

export interface ClientCollectorOptions {
  heartbeatInterval?: number
  logger?: RuntimeLogger
  serverUrl?: string
  autoStart?: boolean
}
```

**收集的信息**: IP、端口、主机名、OS、CPU核数、内存、FRP/Bridge版本

**行为**:
- 初始化时收集并调用 `node.register` (由 Server 自动分配 nodeId)
- 每 30-60s 调用 `node.heartbeat` (可选更新系统信息)
- 优雅关闭时调用 `node.unregister`
- 断网/异常关闭时，Server 自动标记为离线 (心跳超时)

### Client 配置扩展

```typescript
export interface ClientConfig {
  serverAddr: string
  serverPort?: number
  node?: {
    heartbeatInterval?: number
    enableAutoReport?: boolean
  }
}
```

## FrpBridge 集成

```typescript
export class FrpBridge {
  private readonly nodeManager?: NodeManager
  private readonly clientCollector?: ClientNodeCollector

  constructor(options: FrpBridgeOptions) {
    if (this.isServerMode) {
      this.nodeManager = new NodeManager(nodeStorage, nodeManagerOptions)
    }
    if (this.isClientMode) {
      this.clientCollector = new ClientNodeCollector(clientCollectorOptions)
    }
  }

  getNodeManager(): NodeManager | undefined {
    return this.nodeManager
  }

  getClientCollector(): ClientNodeCollector | undefined {
    return this.clientCollector
  }
}

export interface FrpBridgeOptions {
  nodeStorage?: NodeStorage
  process?: FrpBridgeProcessOptions & {
    nodeHeartbeatInterval?: number // Client 端心跳间隔，默认 30s
  }
}
```

## 数据持久化

**文件结构**:
```
~/.frp-bridge/runtime/nodes/
├── nodes.json
└── node-{id}.json
```

**FileNodeStorage 实现**:
```typescript
export class FileNodeStorage implements NodeStorage {
  async save(node: NodeInfo): Promise<void>
  async delete(id: string): Promise<void>
  async load(id: string): Promise<NodeInfo | undefined>
  async list(): Promise<NodeInfo[]>
}
```

---

## 事件和错误处理
### 事件类型

| 事件 | 触发 | 用途 |
|------|------|------|
| `node:registered` | Client 初次连接 | 节点注册 |
| `node:heartbeat` | Client 心跳上报 | 状态和信息更新 |
| `node:unregistered` | Client 主动断开 | 节点注销 |
| `node:statusChanged` | 心跳超时或异常 | 状态变化 (online→offline) |
| `node:statusChanged` | (内部) | 状态变化 |

### 错误处理

```typescript
export type NodeErrorCode
  = | 'NODE_NOT_FOUND' // 节点不存在
    | 'NODE_ALREADY_EXISTS' // 重复注册 (nodeId 冲突)
    | 'INVALID_NODE_DATA' // 数据验证失败
    | 'HEARTBEAT_TIMEOUT' // 心跳超时
    | 'STORAGE_ERROR' // 持久化错误
```

**说明**: Client 侧异常（网络故障、进程崩溃）由 Server 的心跳超时检测处理，自动标记为离线。

---

## 导出结构

```typescript
// packages/core/src/node/index.ts
export { ClientNodeCollector, FileNodeStorage, NodeError, NodeManager }
export type { ClientCollectorOptions, NodeEvent, NodeManagerOptions, NodeStorage }

// packages/types/src/index.ts (追加)
export type {
  CreateNodePayload,
  NodeInfo,
  NodeListQuery,
  NodeListResponse,
  UpdateNodePayload
} from './node'
```

---

## 实现时序

| Phase | 任务 |
|-------|------|
| 1 | 类型定义 (NodeInfo、CreateNodePayload 等) |
| 2 | NodeManager 核心 (CRUD、事件、存储接口) |
| 3 | 持久化 (FileNodeStorage) |
| 4 | Client 集成 (ClientNodeCollector) |
| 5 | Bridge 集成 (命令/查询注册) |

---

## 性能和安全

### 性能
- Map 存储 O(1) 查询
- 分页查询避免全量加载
- 异步 I/O 不阻塞事件循环
- 心跳间隔 30-60s 可配置

### 安全
- 节点创建时验证令牌
- Server 端验证操作权限
- 所有输入数据验证
- 敏感信息 (token) 可选加密

---

## 扩展方向

1. **Dashboard 代理数据集成**: 定期从 frps 拉取代理统计，映射到 NodeInfo
2. **Prometheus 监控**: 集成 `/metrics` 端点到时间序列数据库
3. **节点分组和标签**: 灵活分类和检索机制
4. **告警机制**: 节点离线/异常状态告警
5. **Web Dashboard**: 可视化管理界面
6. **自适应心跳**: 根据网络状况动态调整心跳间隔

/**
 * Node management types
 * Defines types for managing frp-bridge client nodes connected to server
 */

/** Node information structure */
export interface NodeInfo {
  id: string // UUID (assigned by server)
  ip: string // Client IP
  port: number // Client port
  protocol: 'tcp' | 'udp' // Protocol type
  serverAddr: string // Server address
  serverPort: number // Server port
  hostname?: string // Client hostname
  osType?: string // 'linux' | 'darwin' | 'win32'
  osRelease?: string // OS version/release
  platform?: string // 'x64' | 'arm64'
  cpuCores?: number // CPU core count
  memTotal?: number // Total memory in bytes
  frpVersion?: string // FRP binary version
  bridgeVersion?: string // FRP-Bridge version
  status: 'online' | 'offline' | 'connecting' | 'error' // Node status
  lastHeartbeat?: number // Last heartbeat timestamp (ms)
  connectedAt?: number // First connection time (ms)
  labels?: Record<string, string> // Custom labels
  metadata?: Record<string, unknown> // Custom metadata
  token?: string // Authentication token
  createdAt: number // Creation timestamp (ms)
  updatedAt: number // Last update timestamp (ms)
}

/** Payload for node registration (Client → Server) */
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

/** Payload for node heartbeat (Client → Server) */
export interface NodeHeartbeatPayload {
  nodeId: string
  status: 'online' | 'error'
  lastHeartbeat: number
  cpuCores?: number
  memTotal?: number
}

/** Query parameters for listing nodes */
export interface NodeListQuery {
  page?: number // Page number, starting from 1
  pageSize?: number // Items per page, default 20
  status?: NodeInfo['status'] // Filter by status
  labels?: Record<string, string> // Filter by labels
  search?: string // Search by hostname, ip, or name
}

/** Response for node list query */
export interface NodeListResponse {
  items: NodeInfo[]
  total: number // Total count
  page: number
  pageSize: number
  hasMore: boolean
}

/** Node statistics */
export interface NodeStatistics {
  total: number // Total node count
  online: number // Online node count
  offline: number // Offline node count
  connecting: number // Connecting node count
  error: number // Error state node count
}

/** Error codes for node operations */
export type NodeErrorCode =
  | 'NODE_NOT_FOUND' // Node does not exist
  | 'NODE_ALREADY_EXISTS' // Duplicate node registration
  | 'INVALID_NODE_DATA' // Invalid node data
  | 'HEARTBEAT_TIMEOUT' // Heartbeat timeout
  | 'STORAGE_ERROR' // Storage operation error
  | 'UNAUTHORIZED' // Unauthorized access

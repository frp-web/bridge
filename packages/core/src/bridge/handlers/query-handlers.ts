import type { NodeManager } from '../../node'
import type { FrpProcessManager } from '../../process'
import type { FrpRuntime, QueryHandler } from '../../runtime'
import type { ProxyGetPayload } from '../types'

/**
 * External dependencies needed by query handlers
 */
export interface QueryDependencies {
  process: FrpProcessManager
  nodeManager?: NodeManager
  runtime: FrpRuntime
  mode: 'client' | 'server'
}

/**
 * Create process status query handler
 */
export function createProcessStatusQuery(deps: QueryDependencies): QueryHandler {
  return async () => {
    const runtimeState = deps.runtime.snapshot()
    return {
      result: {
        running: deps.process.isRunning(),
        config: deps.process.getConfig()
      },
      version: runtimeState.version
    }
  }
}

/**
 * Create runtime snapshot query handler
 */
export function createRuntimeSnapshotQuery(deps: QueryDependencies): QueryHandler {
  return async () => {
    const runtimeState = deps.runtime.snapshot()
    return {
      result: runtimeState,
      version: runtimeState.version
    }
  }
}

/**
 * Create node list query handler
 */
export function createNodeListQuery(deps: QueryDependencies): QueryHandler {
  return async () => {
    if (!deps.nodeManager) {
      return {
        result: {
          items: [],
          total: 0,
          page: 1,
          pageSize: 100,
          hasMore: false
        },
        version: deps.runtime.snapshot().version
      }
    }

    const query = {
      page: 1,
      pageSize: 100
    }

    const result = deps.nodeManager.listNodes(query)
    return {
      result,
      version: deps.runtime.snapshot().version
    }
  }
}

/**
 * Create node get query handler
 */
export function createNodeGetQuery(deps: QueryDependencies): QueryHandler {
  return async (query) => {
    if (!deps.nodeManager) {
      return {
        result: null,
        version: deps.runtime.snapshot().version
      }
    }

    const nodeId = (query.payload as any)?.nodeId
    if (!nodeId) {
      return {
        result: null,
        version: deps.runtime.snapshot().version
      }
    }

    const node = deps.nodeManager.getNode(nodeId)
    return {
      result: node ?? null,
      version: deps.runtime.snapshot().version
    }
  }
}

/**
 * Create node statistics query handler
 */
export function createNodeStatisticsQuery(deps: QueryDependencies): QueryHandler {
  return async () => {
    if (!deps.nodeManager) {
      return {
        result: {
          total: 0,
          online: 0,
          offline: 0,
          connecting: 0,
          error: 0
        },
        version: deps.runtime.snapshot().version
      }
    }

    const stats = deps.nodeManager.getStatistics()
    return {
      result: stats,
      version: deps.runtime.snapshot().version
    }
  }
}

/**
 * Create proxy list query handler
 */
export function createProxyListQuery(deps: QueryDependencies): QueryHandler {
  return async () => {
    if (deps.mode !== 'client') {
      return {
        result: [],
        version: deps.runtime.snapshot().version
      }
    }

    try {
      const tunnels = deps.process.listTunnels()
      return {
        result: tunnels,
        version: deps.runtime.snapshot().version
      }
    }
    catch {
      return {
        result: [],
        version: deps.runtime.snapshot().version
      }
    }
  }
}

/**
 * Create proxy get query handler
 */
export function createProxyGetQuery(deps: QueryDependencies): QueryHandler {
  return async (query) => {
    if (deps.mode !== 'client') {
      return {
        result: null,
        version: deps.runtime.snapshot().version
      }
    }

    const name = (query.payload as ProxyGetPayload)?.name
    if (!name) {
      return {
        result: null,
        version: deps.runtime.snapshot().version
      }
    }

    try {
      const tunnel = deps.process.getTunnel(name)
      return {
        result: tunnel ?? null,
        version: deps.runtime.snapshot().version
      }
    }
    catch {
      return {
        result: null,
        version: deps.runtime.snapshot().version
      }
    }
  }
}

/**
 * Factory to create all query handlers
 */
export function createQueryHandlers(deps: QueryDependencies): Record<string, QueryHandler> {
  return {
    'process.status': createProcessStatusQuery(deps),
    'runtime.snapshot': createRuntimeSnapshotQuery(deps),
    'node.list': createNodeListQuery(deps),
    'node.get': createNodeGetQuery(deps),
    'node.statistics': createNodeStatisticsQuery(deps),
    'proxy.list': createProxyListQuery(deps),
    'proxy.get': createProxyGetQuery(deps)
  }
}

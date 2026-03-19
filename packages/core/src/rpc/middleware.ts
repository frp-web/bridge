/**
 * RPC 中间件系统
 * 提供可扩展的请求处理管道
 */

import type { RpcRequest, RpcResponse } from './message-types'
import { rpcMiddlewareLogger } from '@frp-bridge/shared'

/**
 * 中间件上下文
 */
export interface MiddlewareContext {
  request: RpcRequest
  response: Partial<RpcResponse>
  startTime: number
}

/**
 * 中间件函数类型
 */
export type MiddlewareFn = (
  context: MiddlewareContext,
  next: () => Promise<void>
) => Promise<void>

/**
 * 中间件选项
 */
export interface MiddlewareOptions {
  preHooks?: MiddlewareFn[]
  postHooks?: MiddlewareFn[]
}

/**
 * 日志中间件
 */
export function loggingMiddleware(): MiddlewareFn {
  return async (context, next) => {
    const { request } = context
    rpcMiddlewareLogger.info('RPC request', { method: request.method, params: request.params })

    try {
      await next()
      rpcMiddlewareLogger.info('RPC response', {
        method: request.method,
        duration: Date.now() - context.startTime,
        status: context.response.status
      })
    }
    catch (error) {
      rpcMiddlewareLogger.error('RPC error', {
        method: request.method,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }
}

/**
 * 认证中间件
 */
export function authMiddleware(
  validateToken: (token: string | undefined) => boolean | Promise<boolean>
): MiddlewareFn {
  return async (context, next) => {
    const { request, response } = context
    const token = request.params.token as string | undefined

    const isValid = await validateToken(token)
    if (!isValid) {
      response.status = 'error'
      response.error = { code: 'UNAUTHORIZED', message: 'Invalid or missing token' }
      return
    }

    await next()
  }
}

/**
 * 超时中间件
 */
export function timeoutMiddleware(timeoutMs: number): MiddlewareFn {
  return async (context, next) => {
    const { request } = context

    // 使用请求指定的超时或默认超时
    const timeout = request.timeout ?? timeoutMs

    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`RPC timeout: ${request.method}`))
      }, timeout)
    })

    try {
      await Promise.race([next(), timeoutPromise])
    }
    catch (error) {
      context.response.status = 'error'
      context.response.error = {
        code: 'TIMEOUT',
        message: error instanceof Error ? error.message : 'Request timeout'
      }
      throw error
    }
  }
}

/**
 * 错误处理中间件
 */
export function errorHandlerMiddleware(): MiddlewareFn {
  return async (context, next) => {
    try {
      await next()
    }
    catch (error) {
      context.response.status = 'error'
      context.response.error = {
        code: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error'
      }
      rpcMiddlewareLogger.error('RPC middleware error', error)
    }
  }
}

/**
 * 中间件管道
 */
export class MiddlewarePipeline {
  private middlewares: MiddlewareFn[] = []

  /**
   * 添加中间件
   */
  use(middleware: MiddlewareFn): this {
    this.middlewares.push(middleware)
    return this
  }

  /**
   * 执行中间件管道
   */
  async execute(
    request: RpcRequest,
    handler: () => Promise<unknown>
  ): Promise<Partial<RpcResponse>> {
    const context: MiddlewareContext = {
      request,
      response: { id: request.id },
      startTime: Date.now()
    }

    // 构建中间件链
    let next: () => Promise<void> = async () => this.executeHandler(context, handler)
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const middleware = this.middlewares[i]
      const prevNext = next
      next = async () => middleware(context, prevNext)
    }

    await next()

    return context.response
  }

  /**
   * 执行处理器
   */
  private async executeHandler(
    context: MiddlewareContext,
    handler: () => Promise<unknown>
  ): Promise<void> {
    const result = await handler()
    context.response.result = result
    context.response.status = 'success'
  }

  /**
   * 清空中间件
   */
  clear(): void {
    this.middlewares = []
  }
}

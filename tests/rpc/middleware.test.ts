/**
 * Unit tests for RPC Middleware
 */

import type { RpcRequest } from '../../packages/core/src/rpc/message-types'
import { describe, expect, it, vi } from 'vitest'
import {
  authMiddleware,
  errorHandlerMiddleware,
  loggingMiddleware,
  MiddlewarePipeline,
  timeoutMiddleware
} from '../../packages/core/src/rpc/middleware'

describe('rPC middleware', () => {
  describe('loggingMiddleware', () => {
    it('should log requests and responses', async () => {
      const logger = {
        info: vi.fn(),
        error: vi.fn()
      }

      const middleware = loggingMiddleware(logger)
      const request: RpcRequest = {
        id: 'test-id',
        method: 'test.method',
        params: { foo: 'bar' }
      }

      const handler = vi.fn().mockResolvedValue({ result: 'success' })

      const context = {
        request,
        response: { id: request.id },
        startTime: Date.now()
      }

      await middleware(context, () => handler())

      expect(logger.info).toHaveBeenCalledWith('RPC request', {
        method: 'test.method',
        params: { foo: 'bar' }
      })
      expect(logger.info).toHaveBeenCalledWith('RPC response', {
        method: 'test.method',
        duration: expect.any(Number),
        status: undefined
      })
    })

    it('should log errors', async () => {
      const logger = {
        info: vi.fn(),
        error: vi.fn()
      }

      const middleware = loggingMiddleware(logger)
      const request: RpcRequest = {
        id: 'test-id',
        method: 'test.method',
        params: {}
      }

      const error = new Error('Test error')
      const handler = vi.fn().mockRejectedValue(error)

      const context = {
        request,
        response: { id: request.id },
        startTime: Date.now()
      }

      try {
        await middleware(context, () => handler())
      }
      catch {
        // Expected
      }

      expect(logger.error).toHaveBeenCalledWith('RPC error', {
        method: 'test.method',
        error: 'Test error'
      })
    })
  })

  describe('authMiddleware', () => {
    it('should pass with valid token', async () => {
      const validateToken = vi.fn().mockResolvedValue(true)
      const middleware = authMiddleware(validateToken)

      const request: RpcRequest = {
        id: 'test-id',
        method: 'test.method',
        params: { token: 'valid-token' }
      }

      const context = {
        request,
        response: { id: request.id },
        startTime: Date.now()
      }

      const next = vi.fn()

      await middleware(context, next)

      expect(validateToken).toHaveBeenCalledWith('valid-token')
      expect(next).toHaveBeenCalled()
      expect(context.response.status).toBeUndefined()
    })

    it('should reject with invalid token', async () => {
      const validateToken = vi.fn().mockResolvedValue(false)
      const middleware = authMiddleware(validateToken)

      const request: RpcRequest = {
        id: 'test-id',
        method: 'test.method',
        params: { token: 'invalid-token' }
      }

      const context = {
        request,
        response: { id: request.id },
        startTime: Date.now()
      }

      const next = vi.fn()

      await middleware(context, next)

      expect(next).not.toHaveBeenCalled()
      expect(context.response.status).toBe('error')
      expect(context.response.error).toEqual({
        code: 'UNAUTHORIZED',
        message: 'Invalid or missing token'
      })
    })
  })

  describe('timeoutMiddleware', () => {
    it('should timeout slow requests', async () => {
      const middleware = timeoutMiddleware(100)

      const request: RpcRequest = {
        id: 'test-id',
        method: 'test.method',
        params: {}
      }

      const context = {
        request,
        response: { id: request.id },
        startTime: Date.now()
      }

      const slowHandler = () => new Promise(resolve => setTimeout(resolve, 200))

      await expect(middleware(context, slowHandler)).rejects.toThrow('RPC timeout')
    })

    it('should pass fast requests', async () => {
      const middleware = timeoutMiddleware(100)

      const request: RpcRequest = {
        id: 'test-id',
        method: 'test.method',
        params: {}
      }

      const context = {
        request,
        response: { id: request.id },
        startTime: Date.now()
      }

      const fastHandler = () => Promise.resolve({ result: 'success' })

      await expect(middleware(context, fastHandler)).resolves.not.toThrow()
    })
  })

  describe('errorHandlerMiddleware', () => {
    it('should catch and format errors', async () => {
      const logger = { error: vi.fn() }
      const middleware = errorHandlerMiddleware(logger)

      const request: RpcRequest = {
        id: 'test-id',
        method: 'test.method',
        params: {}
      }

      const context = {
        request,
        response: { id: request.id },
        startTime: Date.now()
      }

      const error = new Error('Test error')
      const handler = () => Promise.reject(error)

      await middleware(context, handler)

      expect(context.response.status).toBe('error')
      expect(context.response.error).toEqual({
        code: 'Error',
        message: 'Test error'
      })
      expect(logger.error).toHaveBeenCalledWith('RPC middleware error', error)
    })
  })

  describe('middlewarePipeline', () => {
    it('should execute middleware in order', async () => {
      const pipeline = new MiddlewarePipeline()
      const order: string[] = []

      const middleware1: any = async (ctx: any, next: any) => {
        order.push('middleware1-before')
        await next()
        order.push('middleware1-after')
      }

      const middleware2: any = async (ctx: any, next: any) => {
        order.push('middleware2-before')
        await next()
        order.push('middleware2-after')
      }

      const handler = vi.fn().mockResolvedValue({ result: 'success' })

      pipeline.use(middleware1)
      pipeline.use(middleware2)

      const request: RpcRequest = {
        id: 'test-id',
        method: 'test.method',
        params: {}
      }

      const response = await pipeline.execute(request, handler)

      expect(order).toEqual([
        'middleware1-before',
        'middleware2-before',
        'middleware2-after',
        'middleware1-after'
      ])
      expect(response).toEqual({
        id: 'test-id',
        result: { result: 'success' },
        status: 'success'
      })
    })

    it('should clear middleware', () => {
      const pipeline = new MiddlewarePipeline()
      pipeline.use(loggingMiddleware())
      pipeline.use(authMiddleware(() => true))

      expect((pipeline as any).middlewares.length).toBe(2)

      pipeline.clear()
      expect((pipeline as any).middlewares.length).toBe(0)
    })
  })
})

/**
 * Unit tests for Command Handler Decorators
 */

import type { HandlerDecorator, ValidationResult } from '../../packages/core/src/bridge/handlers/decorators'
import type { CommandDependencies } from '../../packages/core/src/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  compose,
  Validators,
  withClientModeOnly,
  withErrorHandling,
  withNodeManager,
  withProcessRunning,
  withProcessStopped,
  withRpcServer,
  withServerModeOnly,
  withValidation
} from '../../packages/core/src/bridge/handlers/decorators'

describe('command handler decorators', () => {
  let mockDeps: CommandDependencies
  let mockCtx: CommandHandlerContext

  beforeEach(() => {
    mockDeps = {
      mode: 'client',
      process: {
        isRunning: vi.fn(() => false),
        addTunnel: vi.fn(),
        removeTunnel: vi.fn(),
        start: vi.fn(),
        stop: vi.fn()
      } as any,
      nodeManager: {
        isRemotePortInUse: vi.fn(() => ({ inUse: false }))
      } as any,
      rpcServer: {
        rpcCall: vi.fn()
      } as any
    }

    mockCtx = {
      requestVersionBump: vi.fn()
    }
  })

  describe('withServerModeOnly', () => {
    it('should allow execution in server mode', async () => {
      const handler = vi.fn().mockResolvedValue({ status: 'success' })
      const decorated = compose(withErrorHandling, withServerModeOnly)(handler, { ...mockDeps, mode: 'server' })

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(handler).toHaveBeenCalled()
      expect(result.status).toBe('success')
    })

    it('should block execution in client mode', async () => {
      const handler = vi.fn()
      const decorated = compose(withErrorHandling, withServerModeOnly)(handler, { ...mockDeps, mode: 'client' })

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(handler).not.toHaveBeenCalled()
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('MODE_ERROR')
      expect(result.error?.message).toContain('server mode')
    })
  })

  describe('withClientModeOnly', () => {
    it('should allow execution in client mode', async () => {
      const handler = vi.fn().mockResolvedValue({ status: 'success' })
      const decorated = compose(withErrorHandling, withClientModeOnly)(handler, { ...mockDeps, mode: 'client' })

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(handler).toHaveBeenCalled()
      expect(result.status).toBe('success')
    })

    it('should block execution in server mode', async () => {
      const handler = vi.fn()
      const decorated = compose(withErrorHandling, withClientModeOnly)(handler, { ...mockDeps, mode: 'server' })

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(handler).not.toHaveBeenCalled()
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('MODE_ERROR')
    })
  })

  describe('withValidation', () => {
    it('should pass valid payload', async () => {
      const validator: ValidationResult = { valid: true }
      const handler = vi.fn().mockResolvedValue({ status: 'success' })
      const decorated = compose(withErrorHandling, withValidation(() => validator))(handler, mockDeps)

      const result = await decorated({ name: 'test', payload: { foo: 'bar' } }, mockCtx)

      expect(handler).toHaveBeenCalled()
      expect(result.status).toBe('success')
    })

    it('should reject invalid payload', async () => {
      const validator: ValidationResult = { valid: false, error: 'Validation failed' }
      const handler = vi.fn()
      const decorated = compose(withErrorHandling, withValidation(() => validator))(handler, mockDeps)

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(handler).not.toHaveBeenCalled()
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('VALIDATION_ERROR')
    })
  })

  describe('withErrorHandling', () => {
    it('should handle synchronous errors', async () => {
      const handler = vi.fn(() => {
        throw new Error('Test error')
      })
      const decorated = withErrorHandling(handler, mockDeps)

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('RUNTIME_ERROR')
      expect(result.error?.message).toBe('Test error')
    })

    it('should handle asynchronous errors', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Async error'))
      const decorated = withErrorHandling(handler, mockDeps)

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(result.status).toBe('failed')
      expect(result.error?.message).toBe('Async error')
    })

    it('should pass successful results', async () => {
      const handler = vi.fn().mockResolvedValue({ status: 'success', result: 'data' })
      const decorated = withErrorHandling(handler, mockDeps)

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(result.status).toBe('success')
      expect(result.result).toBe('data')
    })
  })

  describe('withProcessRunning', () => {
    it('should allow when process is running', async () => {
      const handler = vi.fn().mockResolvedValue({ status: 'success' })
      const decorated = compose(withErrorHandling, withProcessRunning)(handler, { ...mockDeps, process: { isRunning: () => true } as any })

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(handler).toHaveBeenCalled()
      expect(result.status).toBe('success')
    })

    it('should block when process is not running', async () => {
      const handler = vi.fn()
      const decorated = compose(withErrorHandling, withProcessRunning)(handler, mockDeps)

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(handler).not.toHaveBeenCalled()
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('MODE_ERROR')
    })
  })

  describe('withProcessStopped', () => {
    it('should allow when process is stopped', async () => {
      const handler = vi.fn().mockResolvedValue({ status: 'success' })
      const decorated = compose(withErrorHandling, withProcessStopped)(handler, mockDeps)

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(handler).toHaveBeenCalled()
      expect(result.status).toBe('success')
    })

    it('should block when process is running', async () => {
      const handler = vi.fn()
      const decorated = compose(withErrorHandling, withProcessStopped)(handler, { ...mockDeps, process: { isRunning: () => true } as any })

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(handler).not.toHaveBeenCalled()
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('MODE_ERROR')
    })
  })

  describe('withRpcServer', () => {
    it('should allow when rpcServer exists', async () => {
      const handler = vi.fn().mockResolvedValue({ status: 'success' })
      const decorated = compose(withErrorHandling, withRpcServer)(handler, mockDeps)

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(handler).toHaveBeenCalled()
      expect(result.status).toBe('success')
    })

    it('should block when rpcServer is missing', async () => {
      const handler = vi.fn()
      const decorated = compose(withErrorHandling, withRpcServer)(handler, { ...mockDeps, rpcServer: undefined })

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(handler).not.toHaveBeenCalled()
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('MODE_ERROR')
    })
  })

  describe('withNodeManager', () => {
    it('should allow when nodeManager exists', async () => {
      const handler = vi.fn().mockResolvedValue({ status: 'success' })
      const decorated = compose(withErrorHandling, withNodeManager)(handler, mockDeps)

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(handler).toHaveBeenCalled()
      expect(result.status).toBe('success')
    })

    it('should block when nodeManager is missing', async () => {
      const handler = vi.fn()
      const decorated = compose(withErrorHandling, withNodeManager)(handler, { ...mockDeps, nodeManager: undefined })

      const result = await decorated({ name: 'test', payload: {} }, mockCtx)

      expect(handler).not.toHaveBeenCalled()
      expect(result.status).toBe('failed')
      expect(result.error?.code).toBe('MODE_ERROR')
    })
  })

  describe('validators', () => {
    it('should validate required field', () => {
      const validator = Validators.required<{ name: string }>()
      expect(validator({ name: 'test' })).toEqual({ valid: true })
      expect(validator(null)).toEqual({ valid: false, error: 'payload is required' })
    })

    it('should validate string field', () => {
      const validator = Validators.string<{ name: string }>('name')
      expect(validator({ name: 'test' })).toEqual({ valid: true })
      expect(validator({ name: '' })).toEqual({ valid: false, error: 'name is required and must be a non-empty string' })
      expect(validator({})).toEqual({ valid: false, error: 'name is required and must be a non-empty string' })
    })

    it('should validate number field', () => {
      const validator = Validators.number<{ port: number }>('port', 1, 65535)
      expect(validator({ port: 8080 })).toEqual({ valid: true })
      expect(validator({ port: 0 })).toEqual({ valid: false, error: 'port must be >= 1' })
      expect(validator({ port: 99999 })).toEqual({ valid: false, error: 'port must be <= 65535' })
    })

    it('should combine validators', () => {
      const validator = Validators.all(
        Validators.required<{ name: string }>(),
        Validators.string<{ name: string }>('name')
      )
      expect(validator({ name: 'test' })).toEqual({ valid: true })
      expect(validator(null)).toEqual({ valid: false, error: 'payload is required' })
    })
  })

  describe('compose', () => {
    it('should compose multiple decorators', async () => {
      const order: string[] = []

      const decorator1: HandlerDecorator = handler => async (cmd, ctx) => {
        order.push('1-before')
        const result = await handler(cmd, ctx)
        order.push('1-after')
        return result
      }

      const decorator2: HandlerDecorator = handler => async (cmd, ctx) => {
        order.push('2-before')
        const result = await handler(cmd, ctx)
        order.push('2-after')
        return result
      }

      const handler = vi.fn().mockResolvedValue({ status: 'success' })
      const composed = compose(decorator1, decorator2)(handler, mockDeps)

      const result = await composed({ name: 'test', payload: {} }, mockCtx)

      expect(order).toEqual(['1-before', '2-before', '2-after', '1-after'])
      expect(result.status).toBe('success')
    })
  })
})
